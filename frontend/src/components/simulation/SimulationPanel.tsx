/**
 * Main Simulation Panel - Integrated with Canvas
 * 
 * Unified interface for steady-state and transient analysis
 */

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Play, RotateCcw, Settings2, ChevronRight,
  Activity, CheckCircle2, AlertTriangle
} from 'lucide-react';
import { useSimulationStore } from '../../store/simulationStore';
import { useCycleStore } from '../../store/cycleStore';
import { runSimulation } from '../../lib/simulationApi';
import { MethodologyToggle } from './MethodologyToggle';
import { ParameterPanel } from './ParameterPanel';
import { ResultsDashboard } from './ResultsDashboard';
import { SolverSettings } from './SolverSettings';

export function SimulationPanel() {
  const [showSettings, setShowSettings] = useState(false);
  
  const {
    config,
    result,
    isRunning,
    progress,
    error,
    setComponents,
    setConnections,
    startSimulation,
    setProgress,
    setResult,
    setError,
    clearResult
  } = useSimulationStore();
  
  // Sync with canvas
  const canvasComponents = useCycleStore(s => s.components);
  const canvasConnections = useCycleStore(s => s.connections);
  const canvasFluid = useCycleStore(s => s.fluid);
  
  useEffect(() => {
    // Convert canvas components to simulation format
    const simComponents = canvasComponents.map(c => ({
      id: c.id,
      type: c.type,
      name: c.name || `${c.type}_${c.id.slice(0, 4)}`,
      position: c.position,
      parameters: { ...c.parameters }
    }));
    
    const simConnections = canvasConnections.map(c => ({
      from: c.from,
      to: c.to,
      fromPort: c.fromPort,
      toPort: c.toPort,
      fluid: c.fluid || canvasFluid
    }));
    
    setComponents(simComponents);
    setConnections(simConnections);
  }, [canvasComponents, canvasConnections, canvasFluid, setComponents, setConnections]);
  
  const handleRun = useCallback(async () => {
    if (config.components.length === 0) {
      setError('No components on canvas. Add components to run simulation.');
      return;
    }
    
    startSimulation();
    
    try {
      // Simulate progress updates
      const progressInterval = setInterval(() => {
        setProgress(Math.min(0.9, progress + 0.1));
      }, 500);
      
      const result = await runSimulation(config);
      
      clearInterval(progressInterval);
      setProgress(1);
      
      if (result.success) {
        setResult(result);
      } else {
        setError(result.errors[0] || 'Simulation failed');
      }
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || 'Simulation failed');
    }
  }, [config, progress, startSimulation, setProgress, setResult, setError]);
  
  const hasComponents = config.components.length > 0;
  
  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--tb-bg-base)' }}>
      {/* Header */}
      <div 
        className="flex-shrink-0 flex items-center justify-between px-5 py-3"
        style={{ borderBottom: '1px solid var(--tb-border)' }}
      >
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5" style={{ color: 'var(--tb-accent)' }} />
            <span 
              className="font-bold"
              style={{ color: 'var(--tb-text-primary)', fontFamily: 'Outfit, sans-serif' }}
            >
              Simulation
            </span>
          </div>
          
          <MethodologyToggle />
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors"
            style={{ 
              background: showSettings ? 'var(--tb-accent)' : 'var(--tb-bg-elevated)',
              color: showSettings ? '#fff' : 'var(--tb-text-secondary)',
              border: '1px solid var(--tb-border)'
            }}
          >
            <Settings2 className="w-4 h-4" />
            Settings
          </button>
          
          <button
            onClick={clearResult}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors"
            style={{ 
              background: 'var(--tb-bg-elevated)',
              color: 'var(--tb-text-secondary)',
              border: '1px solid var(--tb-border)'
            }}
          >
            <RotateCcw className="w-4 h-4" />
            Clear
          </button>
        </div>
      </div>
      
      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Parameters */}
        <div 
          className="w-80 flex-shrink-0 flex flex-col overflow-y-auto"
          style={{ 
            borderRight: '1px solid var(--tb-border)',
            background: 'var(--tb-bg-surface)'
          }}
        >
          {/* Solver Settings (Collapsible) */}
          <AnimatePresence>
            {showSettings && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <SolverSettings />
              </motion.div>
            )}
          </AnimatePresence>
          
          {/* Component Parameters */}
          <div className="p-4">
            {!hasComponents ? (
              <div 
                className="text-center py-8 rounded-xl"
                style={{ 
                  background: 'var(--tb-bg-elevated)',
                  border: '1px dashed var(--tb-border)'
                }}
              >
                <p style={{ color: 'var(--tb-text-muted)' }}>
                  No components on canvas.
                </p>
                <p className="text-sm mt-1" style={{ color: 'var(--tb-text-muted)' }}>
                  Add components to the canvas to configure parameters.
                </p>
              </div>
            ) : (
              <ParameterPanel onParameterChange={clearResult} />
            )}
          </div>
        </div>
        
        {/* Right Panel - Results */}
        <div className="flex-1 overflow-y-auto p-6">
          {!result && !isRunning ? (
            <EmptyState onRun={handleRun} hasComponents={hasComponents} error={error} />
          ) : (
            <ResultsDashboard />
          )}
          
          {/* Progress overlay */}
          {isRunning && (
            <div 
              className="fixed inset-0 flex items-center justify-center z-50"
              style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
            >
              <div 
                className="rounded-2xl p-8 w-96"
                style={{ 
                  background: 'var(--tb-bg-surface)',
                  border: '1px solid var(--tb-border)',
                  boxShadow: 'var(--tb-shadow-lg)'
                }}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="animate-spin">
                    <Activity className="w-6 h-6" style={{ color: 'var(--tb-accent)' }} />
                  </div>
                  <div>
                    <h3 
                      className="font-semibold"
                      style={{ color: 'var(--tb-text-primary)' }}
                    >
                      Running Simulation...
                    </h3>
                    <p className="text-sm" style={{ color: 'var(--tb-text-muted)' }}>
                      {config.mode === 'transient' 
                        ? `Integrating ODEs (${config.solver_method})`
                        : 'Solving steady-state equations'
                      }
                    </p>
                  </div>
                </div>
                
                <div 
                  className="h-2 rounded-full overflow-hidden"
                  style={{ background: 'var(--tb-bg-elevated)' }}
                >
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: 'var(--tb-accent)' }}
                    initial={{ width: 0 }}
                    animate={{ width: `${progress * 100}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
                
                <p 
                  className="text-center text-sm mt-3"
                  style={{ color: 'var(--tb-text-muted)' }}
                >
                  {Math.round(progress * 100)}% complete
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Run Button (Floating) */}
      {hasComponents && !result && !isRunning && (
        <motion.button
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          onClick={handleRun}
          className="fixed bottom-8 right-8 flex items-center gap-2 px-6 py-3 rounded-xl font-semibold shadow-lg"
          style={{ 
            background: 'linear-gradient(135deg, var(--tb-accent), #818cf8)',
            color: '#fff',
            boxShadow: '0 8px 32px rgba(14, 165, 233, 0.4)'
          }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <Play className="w-5 h-5" fill="currentColor" />
          Run Simulation
        </motion.button>
      )}
    </div>
  );
}

interface EmptyStateProps {
  onRun: () => void;
  hasComponents: boolean;
  error: string | null;
}

function EmptyState({ onRun, hasComponents, error }: EmptyStateProps) {
  return (
    <div className="h-full flex flex-col items-center justify-center">
      <div 
        className="w-full max-w-md rounded-2xl p-8 text-center"
        style={{ 
          background: 'var(--tb-bg-surface)',
          border: '1px solid var(--tb-border)',
          boxShadow: 'var(--tb-panel-inset)'
        }}
      >
        {error ? (
          <>
            <div 
              className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
              style={{ background: 'rgba(248, 113, 113, 0.15)' }}
            >
              <AlertTriangle className="w-8 h-8" style={{ color: '#f87171' }} />
            </div>
            <h3 
              className="text-lg font-semibold mb-2"
              style={{ color: '#f87171' }}
            >
              Simulation Failed
            </h3>
            <p 
              className="text-sm mb-6"
              style={{ color: 'var(--tb-text-muted)' }}
            >
              {error}
            </p>
          </>
        ) : (
          <>
            <div 
              className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
              style={{ background: 'var(--tb-accent-subtle)' }}
            >
              <Activity className="w-8 h-8" style={{ color: 'var(--tb-accent)' }} />
            </div>
            <h3 
              className="text-lg font-semibold mb-2"
              style={{ color: 'var(--tb-text-primary)' }}
            >
              Ready to Simulate
            </h3>
            <p 
              className="text-sm mb-6"
              style={{ color: 'var(--tb-text-muted)' }}
            >
              Configure parameters on the left, then run the simulation to analyze
              energy, exergy, entropy generation, and temperature evolution.
            </p>
          </>
        )}
        
        {hasComponents && (
          <div className="space-y-2">
            {[
              'First & second law analysis',
              'Entropy generation tracking',
              'Exergy destruction via Gouy-Stodola',
              'Transient temperature evolution'
            ].map((item) => (
              <div 
                key={item}
                className="flex items-center gap-2 text-sm"
                style={{ color: 'var(--tb-text-secondary)' }}
              >
                <CheckCircle2 className="w-4 h-4" style={{ color: '#34d399' }} />
                {item}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
