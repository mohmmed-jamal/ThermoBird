/**
 * ThermoBird — Real-time Transient Simulation Streaming
 * 
 * Replaces polling with Server-Sent Events (SSE) for:
 * - Live progress updates
 * - Partial results streaming
 * - Immediate error notification
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

export type StreamStatus = 'idle' | 'connecting' | 'streaming' | 'completed' | 'error';

interface StreamState {
  status: StreamStatus;
  progress: number;
  etaSeconds: number | null;
  partialData: Array<{
    t: number;
    variables: Record<string, number>;
    derived?: Record<string, number>;
  }>;
  result: any | null;
  error: string | null;
}

interface UseTransientStreamReturn extends StreamState {
  connect: (jobId: string) => void;
  disconnect: () => void;
  isConnected: boolean;
}

export function useTransientStream(): UseTransientStreamReturn {
  const [state, setState] = useState<StreamState>({
    status: 'idle',
    progress: 0,
    etaSeconds: null,
    partialData: [],
    result: null,
    error: null,
  });

  const esRef = useRef<EventSource | null>(null);
  const reconnectAttemptRef = useRef(0);
  const maxReconnectAttempts = 5;
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    reconnectAttemptRef.current = 0;
  }, []);

  const connect = useCallback((jobId: string) => {
    // Clean up any existing connection
    disconnect();

    setState(prev => ({
      ...prev,
      status: 'connecting',
      progress: 0,
      error: null,
      partialData: [],
      result: null,
    }));

    const baseURL = api.defaults.baseURL || '';
    const es = new EventSource(`${baseURL}/transient/${jobId}/stream`);
    esRef.current = es;

    // Connection opened
    es.onopen = () => {
      reconnectAttemptRef.current = 0;
    };

    // Status updates (pending, running, etc.)
    es.addEventListener('status', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        setState(prev => ({
          ...prev,
          status: data.status === 'running' ? 'streaming' : data.status,
        }));
      } catch (err) {
        console.error('Failed to parse status event:', err);
      }
    });

    // Progress updates
    es.addEventListener('progress', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        setState(prev => ({
          ...prev,
          status: 'streaming',
          progress: data.progress || 0,
          etaSeconds: data.eta_seconds || null,
        }));
      } catch (err) {
        console.error('Failed to parse progress event:', err);
      }
    });

    // Partial results (intermediate time steps)
    es.addEventListener('partial', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        setState(prev => ({
          ...prev,
          partialData: [...prev.partialData, {
            t: data.t,
            variables: data.variables || {},
            derived: data.derived,
          }],
        }));
      } catch (err) {
        console.error('Failed to parse partial event:', err);
      }
    });

    // Simulation complete
    es.addEventListener('complete', (e: MessageEvent) => {
      try {
        const result = JSON.parse(e.data);
        setState(prev => ({
          ...prev,
          status: 'completed',
          progress: 1,
          result,
        }));
        disconnect();
      } catch (err) {
        console.error('Failed to parse complete event:', err);
      }
    });

    // Error from simulation
    es.addEventListener('error', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        setState(prev => ({
          ...prev,
          status: 'error',
          error: data.error || 'Simulation failed',
        }));
        disconnect();
      } catch (err) {
        setState(prev => ({
          ...prev,
          status: 'error',
          error: 'Unknown error occurred',
        }));
        disconnect();
      }
    });

    // Connection error - attempt reconnect with exponential backoff
    es.onerror = () => {
      if (reconnectAttemptRef.current < maxReconnectAttempts) {
        const delay = Math.min(1000 * 2 ** reconnectAttemptRef.current, 30000);
        reconnectAttemptRef.current++;
        
        reconnectTimeoutRef.current = setTimeout(() => {
          connect(jobId);
        }, delay);
      } else {
        setState(prev => ({
          ...prev,
          status: 'error',
          error: 'Connection lost after multiple attempts. Please refresh.',
        }));
        disconnect();
      }
    };
  }, [disconnect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

  return {
    ...state,
    connect,
    disconnect,
    isConnected: esRef.current !== null && state.status !== 'error' && state.status !== 'completed',
  };
}

// Hook for consuming partial data in charts (real-time updates)
export function useRealtimeChartData(partialData: StreamState['partialData']) {
  return {
    hasData: partialData.length > 0,
    latestPoint: partialData[partialData.length - 1] || null,
    timeSeries: partialData.map(d => d.t),
    getVariableSeries: (varName: string) => 
      partialData.map(d => d.variables[varName]).filter(v => v !== undefined),
  };
}
