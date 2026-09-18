/**
 * Methodology Toggle - Switch between Steady-State and Transient
 */

import { motion } from 'framer-motion';
import { Activity, Gauge } from 'lucide-react';
import { useSimulationStore, type SimulationMode } from '../../store/simulationStore';

interface MethodologyOption {
  id: SimulationMode;
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
}

const OPTIONS: MethodologyOption[] = [
  {
    id: 'steady_state',
    label: 'Steady State',
    description: 'Equilibrium analysis',
    icon: <Gauge className="w-5 h-5" />,
    color: '#0ea5e9' // blue
  },
  {
    id: 'transient',
    label: 'Transient',
    description: 'Time evolution',
    icon: <Activity className="w-5 h-5" />,
    color: '#f59e0b' // amber
  }
];

export function MethodologyToggle() {
  const { config, setMode } = useSimulationStore();
  const currentMode = config.mode;
  
  return (
    <div 
      className="inline-flex items-center p-1 rounded-xl"
      style={{ 
        background: 'var(--tb-bg-elevated)',
        border: '1px solid var(--tb-border)'
      }}
    >
      {OPTIONS.map((option) => {
        const isActive = currentMode === option.id;
        
        return (
          <button
            key={option.id}
            onClick={() => setMode(option.id)}
            className="relative flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-200"
            style={{
              background: isActive ? 'var(--tb-bg-surface)' : 'transparent',
              boxShadow: isActive ? 'var(--tb-shadow-sm)' : 'none'
            }}
          >
            {/* Active indicator */}
            {isActive && (
              <motion.div
                layoutId="methodology-indicator"
                className="absolute inset-0 rounded-lg"
                style={{
                  border: `2px solid ${option.color}`,
                  background: `${option.color}10`
                }}
                initial={false}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
            
            <span 
              className="relative z-10"
              style={{ color: isActive ? option.color : 'var(--tb-text-muted)' }}
            >
              {option.icon}
            </span>
            
            <div className="relative z-10 text-left">
              <div 
                className="text-sm font-semibold"
                style={{ color: isActive ? 'var(--tb-text-primary)' : 'var(--tb-text-muted)' }}
              >
                {option.label}
              </div>
              <div 
                className="text-xs"
                style={{ color: 'var(--tb-text-muted)' }}
              >
                {option.description}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function MethodologyBadge({ mode }: { mode: SimulationMode }) {
  const colors = {
    steady_state: '#0ea5e9',
    transient: '#f59e0b',
    parametric: '#a78bfa'
  };
  
  const labels = {
    steady_state: 'Steady State',
    transient: 'Transient',
    parametric: 'Parametric'
  };
  
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium"
      style={{
        background: `${colors[mode]}15`,
        color: colors[mode],
        border: `1px solid ${colors[mode]}30`
      }}
    >
      {mode === 'transient' ? <Activity className="w-3 h-3" /> : <Gauge className="w-3 h-3" />}
      {labels[mode]}
    </span>
  );
}
