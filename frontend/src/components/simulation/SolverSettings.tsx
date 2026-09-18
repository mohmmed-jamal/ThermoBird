/**
 * Solver Settings Panel
 */

import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, Info } from 'lucide-react';
import { useSimulationStore } from '../../store/simulationStore';
import { listSolvers } from '../../lib/simulationApi';

interface SolverInfo {
  id: string;
  name: string;
  description: string;
  good_for: string;
  stiffness: string;
}

export function SolverSettings() {
  const [isOpen, setIsOpen] = useState(false);
  const [solvers, setSolvers] = useState<SolverInfo[]>([]);
  const { config, setConfig } = useSimulationStore();
  const isTransient = config.mode === 'transient';
  
  useEffect(() => {
    listSolvers().then(setSolvers);
  }, []);
  
  return (
    <div 
      className="border-b"
      style={{ borderColor: 'var(--tb-border)' }}
    >
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3"
      >
        <span 
          className="font-medium text-sm"
          style={{ color: 'var(--tb-text-primary)' }}
        >
          Solver Settings
        </span>
        {isOpen ? (
          <ChevronUp className="w-4 h-4" style={{ color: 'var(--tb-text-muted)' }} />
        ) : (
          <ChevronDown className="w-4 h-4" style={{ color: 'var(--tb-text-muted)' }} />
        )}
      </button>
      
      {isOpen && (
        <div className="px-4 pb-4 space-y-4">
          {isTransient ? (
            <>
              {/* Solver Method */}
              <div>
                <label 
                  className="text-xs font-medium block mb-2"
                  style={{ color: 'var(--tb-text-secondary)' }}
                >
                  ODE Solver Method
                </label>
                <select
                  value={config.solver_method}
                  onChange={(e) => setConfig({ solver_method: e.target.value })}
                  className="w-full rounded-lg px-3 py-2 text-sm"
                  style={{
                    background: 'var(--tb-bg-base)',
                    border: '1px solid var(--tb-border)',
                    color: 'var(--tb-text-primary)'
                  }}
                >
                  {solvers.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} - {s.good_for}
                    </option>
                  ))}
                </select>
                <p 
                  className="text-xs mt-1 flex items-center gap-1"
                  style={{ color: 'var(--tb-text-muted)' }}
                >
                  <Info className="w-3 h-3" />
                  {solvers.find(s => s.id === config.solver_method)?.description}
                </p>
              </div>
              
              {/* Time Settings */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label 
                    className="text-xs font-medium block mb-2"
                    style={{ color: 'var(--tb-text-secondary)' }}
                  >
                    End Time (s)
                  </label>
                  <input
                    type="number"
                    value={config.t_end}
                    onChange={(e) => setConfig({ t_end: parseFloat(e.target.value) })}
                    className="w-full rounded-lg px-3 py-2 text-sm"
                    style={{
                      background: 'var(--tb-bg-base)',
                      border: '1px solid var(--tb-border)',
                      color: 'var(--tb-text-primary)'
                    }}
                  />
                </div>
                <div>
                  <label 
                    className="text-xs font-medium block mb-2"
                    style={{ color: 'var(--tb-text-secondary)' }}
                  >
                    Time Steps
                  </label>
                  <input
                    type="number"
                    value={config.t_steps}
                    onChange={(e) => setConfig({ t_steps: parseInt(e.target.value) })}
                    className="w-full rounded-lg px-3 py-2 text-sm"
                    style={{
                      background: 'var(--tb-bg-base)',
                      border: '1px solid var(--tb-border)',
                      color: 'var(--tb-text-primary)'
                    }}
                  />
                </div>
              </div>
              
              {/* Tolerance */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label 
                    className="text-xs font-medium block mb-2"
                    style={{ color: 'var(--tb-text-secondary)' }}
                  >
                    Relative Tolerance
                  </label>
                  <input
                    type="number"
                    value={config.rtol}
                    onChange={(e) => setConfig({ rtol: parseFloat(e.target.value) })}
                    step={1e-5}
                    className="w-full rounded-lg px-3 py-2 text-sm"
                    style={{
                      background: 'var(--tb-bg-base)',
                      border: '1px solid var(--tb-border)',
                      color: 'var(--tb-text-primary)'
                    }}
                  />
                </div>
                <div>
                  <label 
                    className="text-xs font-medium block mb-2"
                    style={{ color: 'var(--tb-text-secondary)' }}
                  >
                    Absolute Tolerance
                  </label>
                  <input
                    type="number"
                    value={config.atol}
                    onChange={(e) => setConfig({ atol: parseFloat(e.target.value) })}
                    step={1e-7}
                    className="w-full rounded-lg px-3 py-2 text-sm"
                    style={{
                      background: 'var(--tb-bg-base)',
                      border: '1px solid var(--tb-border)',
                      color: 'var(--tb-text-primary)'
                    }}
                  />
                </div>
              </div>
              
              {/* Stiffness Detection */}
              <div className="flex items-center justify-between">
                <label 
                  className="text-xs font-medium"
                  style={{ color: 'var(--tb-text-secondary)' }}
                >
                  Auto Stiffness Detection
                </label>
                <input
                  type="checkbox"
                  checked={config.stiffness_detection}
                  onChange={(e) => setConfig({ stiffness_detection: e.target.checked })}
                  className="w-4 h-4 rounded"
                />
              </div>
            </>
          ) : (
            <>
              {/* Steady-state settings */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label 
                    className="text-xs font-medium block mb-2"
                    style={{ color: 'var(--tb-text-secondary)' }}
                  >
                    Max Iterations
                  </label>
                  <input
                    type="number"
                    value={config.max_iterations}
                    onChange={(e) => setConfig({ max_iterations: parseInt(e.target.value) })}
                    className="w-full rounded-lg px-3 py-2 text-sm"
                    style={{
                      background: 'var(--tb-bg-base)',
                      border: '1px solid var(--tb-border)',
                      color: 'var(--tb-text-primary)'
                    }}
                  />
                </div>
                <div>
                  <label 
                    className="text-xs font-medium block mb-2"
                    style={{ color: 'var(--tb-text-secondary)' }}
                  >
                    Convergence Tolerance
                  </label>
                  <input
                    type="number"
                    value={config.tolerance}
                    onChange={(e) => setConfig({ tolerance: parseFloat(e.target.value) })}
                    step={1e-6}
                    className="w-full rounded-lg px-3 py-2 text-sm"
                    style={{
                      background: 'var(--tb-bg-base)',
                      border: '1px solid var(--tb-border)',
                      color: 'var(--tb-text-primary)'
                    }}
                  />
                </div>
              </div>
            </>
          )}
          
          {/* Dead State */}
          <div className="pt-3 border-t" style={{ borderColor: 'var(--tb-border-soft)' }}>
            <label 
              className="text-xs font-medium block mb-2"
              style={{ color: 'var(--tb-text-secondary)' }}
            >
              Dead State (for exergy)
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="text-xs" style={{ color: 'var(--tb-text-muted)' }}>
                  T₀ (K)
                </span>
                <input
                  type="number"
                  value={config.T0}
                  onChange={(e) => setConfig({ T0: parseFloat(e.target.value) })}
                  className="w-full rounded-lg px-3 py-2 text-sm mt-1"
                  style={{
                    background: 'var(--tb-bg-base)',
                    border: '1px solid var(--tb-border)',
                    color: 'var(--tb-text-primary)'
                  }}
                />
              </div>
              <div>
                <span className="text-xs" style={{ color: 'var(--tb-text-muted)' }}>
                  P₀ (Pa)
                </span>
                <input
                  type="number"
                  value={config.P0}
                  onChange={(e) => setConfig({ P0: parseFloat(e.target.value) })}
                  className="w-full rounded-lg px-3 py-2 text-sm mt-1"
                  style={{
                    background: 'var(--tb-bg-base)',
                    border: '1px solid var(--tb-border)',
                    color: 'var(--tb-text-primary)'
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
