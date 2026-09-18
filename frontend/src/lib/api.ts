// TheroBird v3 — Axios API Client
import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1'

export const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
})

// No auth tokens in public mode — do not attach Authorization headers or
// attempt refresh flows. Keep client simple for anonymous usage.

// Auth functionality removed for public mode. Login/signup/change-password
// endpoints are intentionally not used. If you need to re-enable auth later,
// restore these helpers.

// ── Properties ────────────────────────────────────────────────────────────────

export interface PropertyCalculationRequest {
  fluid: string; input1_type: string; input1_value: number
  input2_type: string; input2_value: number; unit_system?: string
}
export interface DiagramRequest  { fluid: string; T: number; P: number; H: number; S: number }
export interface DiagramResponse { ts: string; ph: string }

export const calculateProperties = async (p: PropertyCalculationRequest) =>
  (await api.post('/properties/calculate', p)).data
export const getPropertyPairs    = async (): Promise<[string, string][]> =>
  (await api.get('/properties/pairs')).data.pairs
export const getDiagrams         = async (p: DiagramRequest): Promise<DiagramResponse> =>
  (await api.post('/properties/diagrams', p)).data
export const getFluids           = async (): Promise<string[]> =>
  (await api.get('/properties/fluids')).data.fluids

// ── Equation Solver ──────────────────────────────────────────────────────────

export interface SolveRequest   { script: string }
export interface SolverStep     { line: number; expr: string; result: any; ok: boolean; msg: string }
export interface SolveResponse  {
  success: boolean
  variables: Record<string, any>
  execution_time_ms: number
  errors: string[]
  warnings: string[]
  steps: SolverStep[]
}

export const solveEquations = async (script: string): Promise<SolveResponse> =>
  (await api.post('/solver/solve', { script })).data

// ── Solver Scripts (DB-persisted) ─────────────────────────────────────────────

export interface SolverScriptRow {
  id: number
  name: string
  script: string
  result_json: SolveResponse | null
  variable_count: number | null
  execution_time_ms: number | null
  success: boolean | null
  created_at: string
  updated_at: string
}

export const saveSolverScript = async (
  name: string, script: string, result: SolveResponse
): Promise<SolverScriptRow> =>
  (await api.post('/solver-scripts', {
    name, script,
    result_json: result,
    variable_count: Object.keys(result.variables).length,
    execution_time_ms: result.execution_time_ms,
    success: result.success,
  })).data

export const listSolverScripts  = async (): Promise<SolverScriptRow[]> =>
  (await api.get('/solver-scripts')).data

export const deleteSolverScript = async (id: number): Promise<void> =>
  void (await api.delete(`/solver-scripts/${id}`))

// ── Simulations ───────────────────────────────────────────────────────────────

export interface RunSimulationParams {
  ambient_temperature?: number; ambient_pressure?: number
  tolerance?: number; max_iterations?: number
}

export const runSimulation = async (simulationId: number, params: RunSimulationParams = {}) =>
  (await api.post(`/simulations/${simulationId}/run`, params)).data
export const getSimulation    = async (id: number) => (await api.get(`/simulations/${id}`)).data
export const listSimulations  = async () => (await api.get('/simulations')).data
export const createSimulation = async (s: any) => (await api.post('/simulations', s)).data
export const updateSimulation = async (id: number, u: any) => (await api.patch(`/simulations/${id}`, u)).data
export const deleteSimulation = async (id: number) => api.delete(`/simulations/${id}`)

export const addComponent    = async (sid: number, c: any) => (await api.post(`/simulations/${sid}/components`, c)).data
export const updateComponent = async (sid: number, cid: number, u: any) =>
  (await api.patch(`/simulations/${sid}/components/${cid}`, u)).data
export const deleteComponent = async (sid: number, cid: number) => api.delete(`/simulations/${sid}/components/${cid}`)

export const addConnection    = async (sid: number, c: any) => (await api.post(`/simulations/${sid}/connections`, c)).data
export const deleteConnection = async (sid: number, cid: number) => api.delete(`/simulations/${sid}/connections/${cid}`)

export const saveCanvas = async (opts: {
  simulationId: number | null; name: string; cycleType: string; fluid: string
  massFlowRate: number; deadStateT0: number; deadStateP0: number
  components: any[]; connections: any[]
}): Promise<number> => {
  const { simulationId, name, cycleType, fluid, components, connections,
          massFlowRate, deadStateT0, deadStateP0 } = opts

  if (simulationId) await api.delete(`/simulations/${simulationId}`)

  const created = await createSimulation({
    name,
    description: JSON.stringify({ fluid, massFlowRate, deadStateT0, deadStateP0 }),
    cycle_type: cycleType,
    is_public: false,
  })
  const id: number = created.id
  const compIdMap: Record<string, number> = {}

  for (const c of components) {
    const added = await addComponent(id, {
      component_type: c.type, component_name: c.name,
      position_x: c.position.x, position_y: c.position.y, parameters: c.parameters,
    })
    compIdMap[c.id] = added.id
  }

  for (const conn of connections) {
    const fId = compIdMap[conn.from], tId = compIdMap[conn.to]
    if (fId && tId) {
      await addConnection(id, {
        from_component_id: fId, to_component_id: tId,
        from_port: conn.fromPort, to_port: conn.toPort,
        fluid_name: conn.fluid || fluid,
      })
    }
  }
  return id
}

export const loadSimulationCanvas = async (id: number) => (await api.get(`/simulations/${id}`)).data

// ── Parametric Analysis ───────────────────────────────────────────────────────

export interface SweepVariable {
  name:   string
  label?: string
  min?:   number
  max?:   number
  steps?: number
  values?: number[]
}

export interface OutputKPI {
  name:  string
  label?: string
}

export interface ParametricRunRequest {
  name:          string
  description?:  string
  source_type:   'solver' | 'canvas'
  script?:       string
  simulation_id?: number
  variables:     SweepVariable[]
  outputs?:      OutputKPI[]
  generate_plots?: boolean
  save_study?:   boolean
}

export interface ParametricRunResponse {
  study_id:         number | null
  name:             string
  axes:             { name: string; label: string; values: number[] }[]
  outputs:          Record<string, (number | null)[]>
  run_count:        number
  success_count:    number
  error_count:      number
  execution_time_ms: number
  plot_data:        any
  errors:           string[]
}

export interface ParametricStudyRow {
  id:              number
  name:            string
  description:     string | null
  source_type:     string
  status:          string
  run_count:       number | null
  execution_time_ms: number | null
  generate_plots:  boolean
  variables_config: any[]
  output_config:   any[]
  result_matrix:   any
  plot_data:       any
  created_at:      string
  updated_at:      string
}

export const runParametric    = async (r: ParametricRunRequest): Promise<ParametricRunResponse> =>
  (await api.post('/parametric/run', r)).data
export const listParametric   = async (): Promise<ParametricStudyRow[]> =>
  (await api.get('/parametric')).data
export const getParametric    = async (id: number): Promise<ParametricStudyRow> =>
  (await api.get(`/parametric/${id}`)).data
export const deleteParametric = async (id: number): Promise<void> =>
  void (await api.delete(`/parametric/${id}`))

// ── Transient Analysis (v2) ───────────────────────────────────────────────────

export interface TransientComponentConfig {
  id?: string
  type: string
  params: Record<string, number>
  initial_conditions: Record<string, number>
}

export interface TransientConnectionConfig {
  from: string
  to: string
  from_port?: string
  to_port?: string
}

export interface TransientRunRequest {
  fluid:      string
  t_end:      number
  t_steps:    number
  T0:         number
  P0:         number
  rtol:       number
  atol:       number
  solver_method?: string      // RK45 | Radau | BDF | LSODA | Auto
  stiffness_detection?: boolean
  components: TransientComponentConfig[]
  connections?: TransientConnectionConfig[]
  simulation_id?: number | null
}

export interface SolverMethodInfo {
  id: string
  name: string
  description: string
  good_for: string
  stiffness: string
  educational_only: boolean
}

export interface TransientJobStatus {
  job_id:    number
  status:    'pending' | 'running' | 'completed' | 'failed'
  progress:  number
  error_msg?: string | null
}

export interface TransientResult {
  job_id:    number
  success:   boolean
  t:         number[]
  variables: Record<string, number[]>
  derived:   Record<string, number[]>
  metadata?: {
    fluid: string; t_span: number[]; n_steps: number
    solver_nfev: number; execution_ms: number; solver_message: string
  }
  errors: string[]
}

export const submitTransientRun = async (r: TransientRunRequest): Promise<TransientJobStatus> =>
  (await api.post('/transient/run', r)).data

export const getTransientStatus = async (jobId: number): Promise<TransientJobStatus> =>
  (await api.get(`/transient/${jobId}/status`)).data

export const getTransientResult = async (jobId: number): Promise<TransientResult> =>
  (await api.get(`/transient/${jobId}/result`)).data

export const listSolvers = async (): Promise<SolverMethodInfo[]> =>
  (await api.get('/transient/solvers')).data

export const getTransientStreamUrl = (jobId: number): string =>
  `${BASE_URL}/transient/${jobId}/stream`
