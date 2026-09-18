/**
 * Interactive Parameter Panel with Sliders
 * For adjusting component parameters in real-time
 */

import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { 
  Thermometer, Wind, Droplets, Activity, 
  Settings2, ChevronDown, ChevronUp, RotateCcw
} from 'lucide-react';
import { useSimulationStore } from '../../store/simulationStore';
// useDebounce hook defined locally to avoid import issues

interface ParameterDef {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  icon: React.ReactNode;
  category: 'thermal' | 'flow' | 'geometry' | 'efficiency';
}

// Parameter definitions by component type
const PARAMETER_DEFS: Record<string, ParameterDef[]> = {
  boiler: [
    { key: 'T_source', label: 'Source Temp', unit: 'K', min: 400, max: 1500, step: 10, icon: <Thermometer className="w-4 h-4" />, category: 'thermal' },
    { key: 'P_operating', label: 'Pressure', unit: 'Pa', min: 1e5, max: 10e6, step: 1e5, icon: <Activity className="w-4 h-4" />, category: 'thermal' },
    { key: 'UA_source', label: 'Source UA', unit: 'W/K', min: 1000, max: 20000, step: 500, icon: <Wind className="w-4 h-4" />, category: 'thermal' },
    { key: 'wall_mass', label: 'Wall Mass', unit: 'kg', min: 10, max: 1000, step: 10, icon: <Droplets className="w-4 h-4" />, category: 'geometry' },
    { key: 'mass_flow', label: 'Mass Flow', unit: 'kg/s', min: 0.1, max: 10, step: 0.1, icon: <Wind className="w-4 h-4" />, category: 'flow' },
  ],
  condenser: [
    { key: 'T_sink', label: 'Sink Temp', unit: 'K', min: 273, max: 350, step: 1, icon: <Thermometer className="w-4 h-4" />, category: 'thermal' },
    { key: 'P_operating', label: 'Pressure', unit: 'Pa', min: 1000, max: 1e5, step: 1000, icon: <Activity className="w-4 h-4" />, category: 'thermal' },
    { key: 'UA_sink', label: 'Sink UA', unit: 'W/K', min: 1000, max: 15000, step: 500, icon: <Wind className="w-4 h-4" />, category: 'thermal' },
    { key: 'wall_mass', label: 'Wall Mass', unit: 'kg', min: 10, max: 500, step: 10, icon: <Droplets className="w-4 h-4" />, category: 'geometry' },
    { key: 'mass_flow', label: 'Mass Flow', unit: 'kg/s', min: 0.1, max: 10, step: 0.1, icon: <Wind className="w-4 h-4" />, category: 'flow' },
  ],
  turbine: [
    { key: 'P_in', label: 'Inlet Pressure', unit: 'Pa', min: 1e5, max: 10e6, step: 1e5, icon: <Activity className="w-4 h-4" />, category: 'thermal' },
    { key: 'P_out', label: 'Outlet Pressure', unit: 'Pa', min: 1000, max: 1e5, step: 1000, icon: <Activity className="w-4 h-4" />, category: 'thermal' },
    { key: 'eta_isentropic', label: 'Efficiency', unit: '-', min: 0.5, max: 0.95, step: 0.01, icon: <Settings2 className="w-4 h-4" />, category: 'efficiency' },
    { key: 'inertia', label: 'Inertia', unit: 'kg·m²', min: 1, max: 100, step: 1, icon: <Droplets className="w-4 h-4" />, category: 'geometry' },
    { key: 'mass_flow', label: 'Mass Flow', unit: 'kg/s', min: 0.1, max: 10, step: 0.1, icon: <Wind className="w-4 h-4" />, category: 'flow' },
  ],
  pump: [
    { key: 'P_in', label: 'Inlet Pressure', unit: 'Pa', min: 1000, max: 1e5, step: 1000, icon: <Activity className="w-4 h-4" />, category: 'thermal' },
    { key: 'P_out', label: 'Outlet Pressure', unit: 'Pa', min: 1e5, max: 10e6, step: 1e5, icon: <Activity className="w-4 h-4" />, category: 'thermal' },
    { key: 'eta_isentropic', label: 'Efficiency', unit: '-', min: 0.5, max: 0.95, step: 0.01, icon: <Settings2 className="w-4 h-4" />, category: 'efficiency' },
    { key: 'inertia', label: 'Inertia', unit: 'kg·m²', min: 0.5, max: 50, step: 0.5, icon: <Droplets className="w-4 h-4" />, category: 'geometry' },
    { key: 'mass_flow', label: 'Mass Flow', unit: 'kg/s', min: 0.1, max: 10, step: 0.1, icon: <Wind className="w-4 h-4" />, category: 'flow' },
  ],
  compressor: [
    { key: 'P_in', label: 'Inlet Pressure', unit: 'Pa', min: 1e4, max: 1e5, step: 1000, icon: <Activity className="w-4 h-4" />, category: 'thermal' },
    { key: 'P_out', label: 'Outlet Pressure', unit: 'Pa', min: 1e5, max: 5e6, step: 1e5, icon: <Activity className="w-4 h-4" />, category: 'thermal' },
    { key: 'eta_isentropic', label: 'Efficiency', unit: '-', min: 0.5, max: 0.9, step: 0.01, icon: <Settings2 className="w-4 h-4" />, category: 'efficiency' },
    { key: 'displacement', label: 'Displacement', unit: 'm³', min: 0.0001, max: 0.01, step: 0.0001, icon: <Droplets className="w-4 h-4" />, category: 'geometry' },
    { key: 'mass_flow', label: 'Mass Flow', unit: 'kg/s', min: 0.01, max: 1, step: 0.01, icon: <Wind className="w-4 h-4" />, category: 'flow' },
  ],
};

const CATEGORY_COLORS: Record<string, string> = {
  thermal: '#f59e0b',
  flow: '#0ea5e9',
  geometry: '#6366f1',
  efficiency: '#10b981'
};

interface ParameterPanelProps {
  onParameterChange?: () => void;
}

export function ParameterPanel({ onParameterChange }: ParameterPanelProps) {
  const { config, updateComponentParams } = useSimulationStore();
  const [expandedComps, setExpandedComps] = useState<Set<string>>(new Set());
  
  const toggleExpand = (id: string) => {
    setExpandedComps(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  
  // Debounced parameter update
  const debouncedChange = useDebounce((compId: string, key: string, value: number) => {
    updateComponentParams(compId, { [key]: value });
    onParameterChange?.();
  }, 300);
  
  const handleReset = (compId: string) => {
    // Reset to default values would go here
    onParameterChange?.();
  };
  
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 
          className="text-sm font-semibold uppercase tracking-wider"
          style={{ color: 'var(--tb-text-muted)' }}
        >
          Component Parameters
        </h3>
        <span 
          className="text-xs"
          style={{ color: 'var(--tb-text-muted)' }}
        >
          {config.components.length} components
        </span>
      </div>
      
      {config.components.map((comp) => {
        const isExpanded = expandedComps.has(comp.id);
        const params = PARAMETER_DEFS[comp.type] || [];
        
        if (params.length === 0) return null;
        
        return (
          <motion.div
            key={comp.id}
            className="rounded-xl overflow-hidden"
            style={{ 
              border: '1px solid var(--tb-border)',
              background: 'var(--tb-bg-surface)'
            }}
            initial={false}
          >
            {/* Header */}
            <button
              onClick={() => toggleExpand(comp.id)}
              className="w-full flex items-center justify-between px-4 py-3"
            >
              <div className="flex items-center gap-2">
                <span style={{ color: CATEGORY_COLORS.thermal }}>
                  {getComponentIcon(comp.type)}
                </span>
                <span 
                  className="font-medium text-sm"
                  style={{ color: 'var(--tb-text-primary)' }}
                >
                  {comp.name || comp.id}
                </span>
                <span 
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={{ 
                    background: 'var(--tb-bg-elevated)',
                    color: 'var(--tb-text-muted)'
                  }}
                >
                  {comp.type}
                </span>
              </div>
              
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleReset(comp.id);
                  }}
                  className="p-1 rounded-lg hover:bg-white/5 transition-colors"
                  title="Reset to defaults"
                >
                  <RotateCcw className="w-3.5 h-3.5" style={{ color: 'var(--tb-text-muted)' }} />
                </button>
                {isExpanded ? (
                  <ChevronUp className="w-4 h-4" style={{ color: 'var(--tb-text-muted)' }} />
                ) : (
                  <ChevronDown className="w-4 h-4" style={{ color: 'var(--tb-text-muted)' }} />
                )}
              </div>
            </button>
            
            {/* Parameters */}
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="px-4 pb-4 space-y-4"
                style={{ borderTop: '1px solid var(--tb-border-soft)' }}
              >
                {params.map((param) => (
                  <ParameterSlider
                    key={param.key}
                    def={param}
                    value={comp.parameters[param.key] ?? (param.min + param.max) / 2}
                    onChange={(value) => debouncedChange(comp.id, param.key, value)}
                  />
                ))}
              </motion.div>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}

interface ParameterSliderProps {
  def: ParameterDef;
  value: number;
  onChange: (value: number) => void;
}

function ParameterSlider({ def, value, onChange }: ParameterSliderProps) {
  const [localValue, setLocalValue] = useState(value);
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseFloat(e.target.value);
    setLocalValue(newValue);
    onChange(newValue);
  };
  
  // Format value for display
  const formatValue = (v: number) => {
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
    if (v < 0.01) return v.toExponential(2);
    return v.toFixed(2);
  };
  
  const percentage = ((localValue - def.min) / (def.max - def.min)) * 100;
  
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span style={{ color: CATEGORY_COLORS[def.category] }}>
            {def.icon}
          </span>
          <span 
            className="text-xs font-medium"
            style={{ color: 'var(--tb-text-secondary)' }}
          >
            {def.label}
          </span>
        </div>
        <span 
          className="text-xs font-mono"
          style={{ color: 'var(--tb-text-primary)' }}
        >
          {formatValue(localValue)} {def.unit}
        </span>
      </div>
      
      <div className="relative">
        <input
          type="range"
          min={def.min}
          max={def.max}
          step={def.step}
          value={localValue}
          onChange={handleChange}
          className="w-full h-1.5 rounded-lg appearance-none cursor-pointer"
          style={{
            background: `linear-gradient(to right, ${CATEGORY_COLORS[def.category]} ${percentage}%, var(--tb-bg-elevated) ${percentage}%)`
          }}
        />
      </div>
      
      <div className="flex justify-between text-[10px]" style={{ color: 'var(--tb-text-muted)' }}>
        <span>{formatValue(def.min)}</span>
        <span>{formatValue(def.max)}</span>
      </div>
    </div>
  );
}

function getComponentIcon(type: string): React.ReactNode {
  const icons: Record<string, React.ReactNode> = {
    boiler: <Thermometer className="w-4 h-4" />,
    condenser: <Droplets className="w-4 h-4" />,
    turbine: <Wind className="w-4 h-4" />,
    pump: <Activity className="w-4 h-4" />,
    compressor: <Wind className="w-4 h-4" />,
  };
  return icons[type] || <Settings2 className="w-4 h-4" />;
}

// Simple debounce hook
function useDebounce<T extends (...args: any[]) => void>(
  callback: T,
  delay: number
): T {
  const [timeoutId, setTimeoutId] = useState<ReturnType<typeof setTimeout> | null>(null);
  
  return useCallback((...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId);
    const id = setTimeout(() => callback(...args), delay);
    setTimeoutId(id);
  }, [callback, delay, timeoutId]) as T;
}
