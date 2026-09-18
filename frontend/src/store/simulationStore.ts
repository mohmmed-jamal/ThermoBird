/**
 * ThermoBird v3 - Unified Simulation Store
 * Handles steady-state, transient, and parametric analysis
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

export type SimulationMode = 'steady_state' | 'transient' | 'parametric';

export interface ComponentConfig {
  id: string;
  type: string;
  name: string;
  position: { x: number; y: number };
  parameters: Record<string, number>;
}

export interface ConnectionConfig {
  from: string;
  to: string;
  fromPort?: string;
  toPort?: string;
  fluid?: string;
}

export interface SimulationConfig {
  mode: SimulationMode;
  components: ComponentConfig[];
  connections: ConnectionConfig[];
  
  // Fluid
  fluid: string;
  
  // Dead state
  T0: number;
  P0: number;
  
  // Transient settings
  t_end: number;
  t_steps: number;
  solver_method: string;
  stiffness_detection: boolean;
  rtol: number;
  atol: number;
  
  // Steady-state settings
  max_iterations: number;
  tolerance: number;
}

export interface StatePoint {
  state: string;
  description: string;
  T: number;
  P: number;
  h: number;
  s: number;
  x: number | null;
  psi: number;
}

export interface ComponentResult {
  type: string;
  T_in: number;
  T_out: number;
  P_in: number;
  P_out: number;
  h_in: number;
  h_out: number;
  W_dot?: number;
  Q_in?: number;
  Q_out?: number;
  eta?: number;
}

export interface TimePointResult {
  t: number;
  component_states?: Record<string, any>;
  W_net: number;
  Q_in: number;
  Q_out: number;
  eta_thermal: number;
  eta_carnot: number;
  epsilon_exergy: number;
  exergy_destruction: Record<string, number>;
  entropy_generation: Record<string, number>;
}

export interface SimulationResult {
  success: boolean;
  mode: SimulationMode;
  cycle_type: string;
  
  // Time series (transient)
  time?: number[];
  time_points?: TimePointResult[];
  
  // State points table
  state_points: StatePoint[];
  
  // Component results
  component_results: Record<string, ComponentResult>;
  
  // Global metrics
  W_net: number;
  Q_in: number;
  eta_thermal: number;
  
  // Metadata
  execution_time_ms: number;
  errors: string[];
  
  // Solver info
  solver_method?: string;
  solver_nfev?: number;
}

interface SimulationState {
  // Configuration
  config: SimulationConfig;
  
  // Results
  result: SimulationResult | null;
  
  // Runtime state
  isRunning: boolean;
  progress: number;
  error: string | null;
  
  // UI state
  activeResultTab: string;
  selectedVariables: string[];
  chartZoom: { start: number; end: number } | null;
  
  // Actions
  setMode: (mode: SimulationMode) => void;
  setConfig: (config: Partial<SimulationConfig>) => void;
  setComponents: (components: ComponentConfig[]) => void;
  setConnections: (connections: ConnectionConfig[]) => void;
  updateComponentParams: (id: string, params: Record<string, number>) => void;
  
  // Simulation control
  startSimulation: () => void;
  setProgress: (progress: number) => void;
  setResult: (result: SimulationResult) => void;
  setError: (error: string) => void;
  clearResult: () => void;
  reset: () => void;
  
  // UI actions
  setActiveResultTab: (tab: string) => void;
  toggleVariable: (variable: string) => void;
  setChartZoom: (zoom: { start: number; end: number } | null) => void;
}

const DEFAULT_CONFIG: SimulationConfig = {
  mode: 'steady_state',
  components: [],
  connections: [],
  fluid: 'Water',
  T0: 298.15,
  P0: 101325,
  
  // Transient defaults
  t_end: 600,
  t_steps: 500,
  solver_method: 'Auto',
  stiffness_detection: true,
  rtol: 1e-4,
  atol: 1e-6,
  
  // Steady-state defaults
  max_iterations: 100,
  tolerance: 1e-6
};

export const useSimulationStore = create<SimulationState>()(
  immer(
    persist(
      (set, get) => ({
        config: { ...DEFAULT_CONFIG },
        result: null,
        isRunning: false,
        progress: 0,
        error: null,
        activeResultTab: 'energy',
        selectedVariables: ['T_fluid', 'T_wall', 'eta_thermal'],
        chartZoom: null,
        
        setMode: (mode) => set((state) => {
          state.config.mode = mode;
        }),
        
        setConfig: (config) => set((state) => {
          Object.assign(state.config, config);
        }),
        
        setComponents: (components) => set((state) => {
          state.config.components = components;
        }),
        
        setConnections: (connections) => set((state) => {
          state.config.connections = connections;
        }),
        
        updateComponentParams: (id, params) => set((state) => {
          const comp = state.config.components.find((c: ComponentConfig) => c.id === id);
          if (comp) {
            Object.assign(comp.parameters, params);
          }
        }),
        
        startSimulation: () => set((state) => {
          state.isRunning = true;
          state.progress = 0;
          state.error = null;
          state.result = null;
        }),
        
        setProgress: (progress) => set((state) => {
          state.progress = progress;
        }),
        
        setResult: (result) => set((state) => {
          state.result = result;
          state.isRunning = false;
          state.progress = 1;
        }),
        
        setError: (error) => set((state) => {
          state.error = error;
          state.isRunning = false;
          state.progress = 0;
        }),
        
        clearResult: () => set((state) => {
          state.result = null;
          state.error = null;
          state.progress = 0;
        }),
        
        reset: () => set((state) => {
          state.config = { ...DEFAULT_CONFIG };
          state.result = null;
          state.isRunning = false;
          state.progress = 0;
          state.error = null;
        }),
        
        setActiveResultTab: (tab) => set((state) => {
          state.activeResultTab = tab;
        }),
        
        toggleVariable: (variable) => set((state) => {
          const idx = state.selectedVariables.indexOf(variable);
          if (idx >= 0) {
            state.selectedVariables.splice(idx, 1);
          } else {
            state.selectedVariables.push(variable);
          }
        }),
        
        setChartZoom: (zoom) => set((state) => {
          state.chartZoom = zoom;
        })
      }),
      {
        name: 'thermobird-simulation',
        partialize: (state) => ({
          config: state.config,
          activeResultTab: state.activeResultTab
        })
      }
    )
  )
);

// Utility hooks
export function useSimulationMode() {
  return useSimulationStore(state => state.config.mode);
}

export function useIsTransient() {
  return useSimulationStore(state => state.config.mode === 'transient');
}

export function useSimulationRunning() {
  return useSimulationStore(state => state.isRunning);
}

export function useSimulationProgress() {
  return useSimulationStore(state => state.progress);
}
