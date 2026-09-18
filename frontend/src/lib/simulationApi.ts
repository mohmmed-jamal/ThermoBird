/**
 * ThermoBird v3 - Simulation API Client
 */

import { api } from './api';
import type { 
  SimulationConfig, 
  SimulationResult,
  ComponentConfig,
  ConnectionConfig 
} from '../store/simulationStore';

export interface SimulationRequest {
  mode: string;
  components: ComponentConfig[];
  connections: ConnectionConfig[];
  fluid: string;
  T0: number;
  P0: number;
  t_end?: number;
  t_steps?: number;
  solver_method?: string;
  stiffness_detection?: boolean;
  rtol?: number;
  atol?: number;
  max_iterations?: number;
  tolerance?: number;
}

export interface SolverMethodInfo {
  id: string;
  name: string;
  description: string;
  good_for: string;
  stiffness: string;
}

export interface ComponentTypeInfo {
  type: string;
  icon: string;
  category: string;
  description: string;
  has_transient: boolean;
  state_vars: string[];
}

/**
 * Run simulation (steady-state or transient)
 */
export async function runSimulation(
  config: SimulationConfig
): Promise<SimulationResult> {
  const request: SimulationRequest = {
    mode: config.mode,
    components: config.components,
    connections: config.connections.map(c => ({
      from: c.from,
      to: c.to,
      fromPort: c.fromPort,
      toPort: c.toPort,
      fluid: c.fluid
    })),
    fluid: config.fluid,
    T0: config.T0,
    P0: config.P0,
    t_end: config.t_end,
    t_steps: config.t_steps,
    solver_method: config.solver_method,
    stiffness_detection: config.stiffness_detection,
    rtol: config.rtol,
    atol: config.atol,
    max_iterations: config.max_iterations,
    tolerance: config.tolerance
  };
  
  const response = await api.post('/simulation/run', request);
  return response.data;
}

/**
 * Run transient simulation with SSE streaming
 */
export function runSimulationStream(
  config: SimulationConfig,
  onProgress: (progress: number, data?: any) => void,
  onComplete: (result: SimulationResult) => void,
  onError: (error: string) => void
): () => void {
  const request: SimulationRequest = {
    mode: 'transient',
    components: config.components,
    connections: config.connections,
    fluid: config.fluid,
    T0: config.T0,
    P0: config.P0,
    t_end: config.t_end,
    t_steps: config.t_steps,
    solver_method: config.solver_method
  };
  
  // Build URL with query params for GET, or use POST with EventSource polyfill
  // For simplicity, using a POST with fetch streaming
  const abortController = new AbortController();
  
  const baseURL = api.defaults.baseURL || '';
  
  fetch(`${baseURL}/simulation/run-stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${localStorage.getItem('access_token') || ''}`
    },
    body: JSON.stringify(request),
    signal: abortController.signal
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }
    
    const decoder = new TextDecoder();
    let buffer = '';
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      
      // Process SSE events
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        const dataMatch = line.match(/^data: (.+)$/m);
        if (dataMatch) {
          try {
            const data = JSON.parse(dataMatch[1]);
            
            if (data.status === 'completed') {
              onComplete(data.result);
            } else if (data.status === 'failed') {
              onError(data.error || 'Simulation failed');
            } else {
              onProgress(data.progress || 0, data);
            }
          } catch (e) {
            console.error('Failed to parse SSE data:', e);
          }
        }
      }
    }
  }).catch(err => {
    if (err.name !== 'AbortError') {
      onError(err.message);
    }
  });
  
  // Return cleanup function
  return () => abortController.abort();
}

/**
 * List available solver methods
 */
export async function listSolvers(): Promise<SolverMethodInfo[]> {
  const response = await api.get('/simulation/solvers');
  return response.data;
}

/**
 * List available component types with transient models
 */
export async function listComponentTypes(): Promise<ComponentTypeInfo[]> {
  const response = await api.get('/simulation/component-types');
  return response.data;
}

/**
 * Convert canvas store to simulation config
 */
export function canvasToSimulationConfig(
  canvasComponents: any[],
  canvasConnections: any[],
  fluid: string,
  mode: 'steady_state' | 'transient' = 'steady_state'
): SimulationConfig {
  return {
    mode,
    components: canvasComponents.map(c => ({
      id: c.id,
      type: c.type,
      name: c.name || c.id,
      position: c.position || { x: 0, y: 0 },
      parameters: c.parameters || {}
    })),
    connections: canvasConnections.map(c => ({
      from: c.from,
      to: c.to,
      fromPort: c.fromPort,
      toPort: c.toPort,
      fluid: c.fluid || fluid
    })),
    fluid,
    T0: 298.15,
    P0: 101325,
    t_end: 600,
    t_steps: 500,
    solver_method: 'Auto',
    stiffness_detection: true,
    rtol: 1e-4,
    atol: 1e-6,
    max_iterations: 100,
    tolerance: 1e-6
  };
}
