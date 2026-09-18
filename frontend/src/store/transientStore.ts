/**
 * ThermoBird v2 — Transient Analysis Zustand Store
 *
 * Manages:
 *  - Simulation config (fluid, t_end, components with ICs)
 *  - Job lifecycle (pending → running → completed/failed)
 *  - Polling interval
 *  - Result payload (t[], variables{}, derived{})
 */
import { create } from 'zustand'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TransientComponentConfig {
  id?: string
  type: string                           // boiler | turbine | condenser | pump
  params: Record<string, number>
  initial_conditions: Record<string, number>
}

export interface TransientConnectionConfig {
  from: string
  to: string
  from_port?: string
  to_port?: string
}

export interface TransientConfig {
  fluid:      string
  t_end:      number
  t_steps:    number
  T0:         number
  P0:         number
  rtol:       number
  atol:       number
  solver_method: string      // RK45 | Radau | BDF | LSODA | Auto
  stiffness_detection: boolean
  components: TransientComponentConfig[]
  connections: TransientConnectionConfig[]
}

export interface TransientResult {
  job_id:    number
  success:   boolean
  t:         number[]
  variables: Record<string, number[]>   // state var → time series
  derived:   Record<string, number[]>   // computed quantity → time series
  metadata?: {
    fluid:          string
    t_span:         number[]
    n_steps:        number
    solver_nfev:    number
    execution_ms:   number
    solver_message: string
  }
  errors: string[]
}

export type JobStatus = 'idle' | 'pending' | 'running' | 'completed' | 'failed'
export type TransientSource = 'canvas' | 'solver' | null

// ── Default presets ───────────────────────────────────────────────────────────

// CORRECTED: Parameter names match backend component_models.py exactly
export const DEFAULT_RANKINE_COMPONENTS: TransientComponentConfig[] = [
  {
    type: 'boiler',
    params: {
      // Wall and fluid thermal mass
      wall_mass: 200,           // kg - thermal mass of boiler wall
      fluid_mass: 80,           // kg - mass of working fluid in boiler
      cp_wall: 500,             // J/kg·K - specific heat of wall material
      
      // Heat transfer coefficients
      UA_source: 5000,          // W/K - heat transfer from source to wall
      UA_fluid_wall: 2000,      // W/K - heat transfer from wall to fluid
      
      // Operating conditions
      T_source: 900,            // K - temperature of heat source (flame/HTF)
      P_Pa: 3_000_000,          // Pa - boiler operating pressure
      mass_flow: 2.5,           // kg/s - mass flow rate through boiler
    },
    initial_conditions: { 
      T_fluid_boiler: 320,      // K - initial fluid temperature
      T_wall_boiler: 330        // K - initial wall temperature
    },
  },
  {
    type: 'turbine',
    params: { 
      eta_isentropic: 0.85,     // Isentropic efficiency
      // Note: Turbine inlet enthalpy comes from boiler outlet via coupling
      rotor_inertia: 500,       // kg·m² - rotational inertia
      electrical_load_W: 500_000, // W - electrical load on generator
    },
    initial_conditions: { 
      omega_turbine: 0          // rad/s - start from rest
    },
  },
  {
    type: 'condenser',
    params: {
      fluid_mass: 50,           // kg - mass of condensate
      UA_condenser: 3000,       // W/K - heat transfer to cooling water
      T_sink: 298.15,           // K - cooling water temperature
      P_Pa: 10_000,             // Pa - condenser pressure
      mass_flow: 2.5,           // kg/s - mass flow rate
    },
    initial_conditions: { 
      T_fluid_condenser: 310    // K - initial condensate temperature
    },
  },
  {
    type: 'pump',
    params: { 
      eta_isentropic: 0.80,     // Pump isentropic efficiency
      // Note: Pump pressures should match system pressures
    },
    initial_conditions: { 
      T_pump_out: 320           // K - initial pump outlet temperature
    },
  },
]

export const DEFAULT_CONFIG: TransientConfig = {
  fluid:      'Water',
  t_end:      600,
  t_steps:    300,
  T0:         298.15,
  P0:         101_325,
  rtol:       1e-4,
  atol:       1e-6,
  solver_method: 'Auto',
  stiffness_detection: true,
  components: DEFAULT_RANKINE_COMPONENTS,
  connections: [],
}

// ── Store ─────────────────────────────────────────────────────────────────────

interface TransientState {
  config:       TransientConfig
  source:       TransientSource         // which tab this was launched from
  jobId:        number | null
  jobStatus:    JobStatus
  jobProgress:  number
  jobError:     string | null
  result:       TransientResult | null
  pollingTimer: ReturnType<typeof setInterval> | null
  activeResultTab: number

  setConfig:           (patch: Partial<TransientConfig>) => void
  setComponentParam:   (idx: number, key: string, val: number) => void
  setComponentIC:      (idx: number, key: string, val: number) => void
  setSource:           (s: TransientSource) => void
  resetConfig:         () => void
  startJob:            (jobId: number) => void
  updateJobStatus:     (status: JobStatus, progress: number, error?: string) => void
  setResult:           (r: TransientResult) => void
  clearResult:         () => void
  setPollingTimer:     (t: ReturnType<typeof setInterval> | null) => void
  setActiveResultTab:  (i: number) => void
}

export const useTransientStore = create<TransientState>((set, get) => ({
  config:          { ...DEFAULT_CONFIG },
  source:          null,
  jobId:           null,
  jobStatus:       'idle',
  jobProgress:     0,
  jobError:        null,
  result:          null,
  pollingTimer:    null,
  activeResultTab: 0,

  setConfig:   (patch) => set(s => ({ config: { ...s.config, ...patch } })),
  setSource:   (source) => set({ source }),

  setComponentParam: (idx, key, val) => set(s => {
    const comps = s.config.components.map((c, i) =>
      i === idx ? { ...c, params: { ...c.params, [key]: val } } : c
    )
    return { config: { ...s.config, components: comps } }
  }),

  setComponentIC: (idx, key, val) => set(s => {
    const comps = s.config.components.map((c, i) =>
      i === idx ? { ...c, initial_conditions: { ...c.initial_conditions, [key]: val } } : c
    )
    return { config: { ...s.config, components: comps } }
  }),

  resetConfig: () => set({
    config: {
      fluid:               'Water',
      t_end:               600,
      t_steps:             300,
      T0:                  298.15,
      P0:                  101_325,
      rtol:                1e-4,
      atol:                1e-6,
      solver_method:       'Auto',
      stiffness_detection: true,
      components:          [],   // ← always empty — never auto-load defaults
      connections:         [],
    },
    result:    null,
    jobStatus: 'idle',
    jobId:     null,
    jobError:  null,
    source:    null,   // ← unlink source
  }),

  startJob:        (jobId) => set({ jobId, jobStatus: 'pending', jobProgress: 0, jobError: null, result: null }),
  updateJobStatus: (status, progress, error) => set({ jobStatus: status, jobProgress: progress, jobError: error ?? null }),
  setResult:       (r) => set({ result: r, jobStatus: 'completed', jobProgress: 1 }),

  clearResult: () => {
    const t = get().pollingTimer
    if (t) clearInterval(t)
    set({ result: null, jobStatus: 'idle', jobId: null, jobProgress: 0, jobError: null, pollingTimer: null })
  },

  setPollingTimer:    (t) => set({ pollingTimer: t }),
  setActiveResultTab: (i) => set({ activeResultTab: i }),
}))

// ── API: Parse TBS Script ─────────────────────────────────────────────────────

export interface ParseScriptResponse {
  fluid: string
  t_end: number
  t_steps: number
  state_vars: Record<string, number>
  derivatives: Record<string, string>
  components: TransientComponentConfig[]
  connections?: TransientConnectionConfig[]
  errors: string[]
}

export async function parseSolverScript(source: string): Promise<ParseScriptResponse> {
  const API_BASE = ((import.meta as any)?.env?.VITE_API_URL as string | undefined) || ''
  const response = await fetch(`${API_BASE}/api/v1/transient/parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source }),
  })
  
  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Parse failed: ${error}`)
  }
  
  return await response.json()
}
