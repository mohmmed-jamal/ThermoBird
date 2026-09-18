// ThermoBird — Zustand Cycle Canvas Store  (with undo / redo + solver results)
import { create } from 'zustand'
import type { CycleType } from '../types'
import type { SolveResponse } from '../lib/api'

export interface CanvasComponent {
  id: string
  type: string
  name: string
  position: { x: number; y: number }
  parameters: Record<string, any>
  state?: Record<string, any>
}

export interface CanvasConnection {
  id: string
  from: string
  to: string
  fromPort: string
  toPort: string
  fluid: string
}

interface CanvasSnapshot {
  components:  CanvasComponent[]
  connections: CanvasConnection[]
}

export function computeStateNumbers(
  components: CanvasComponent[],
  connections: CanvasConnection[],
): Record<string, number> {
  if (connections.length === 0) return {}
  const incomingOf: Record<string, CanvasConnection[]> = {}
  const outgoingOf: Record<string, CanvasConnection[]> = {}
  for (const conn of connections) {
    ;(outgoingOf[conn.from] ??= []).push(conn)
    ;(incomingOf[conn.to]   ??= []).push(conn)
  }
  let startConn: CanvasConnection | undefined
  for (const comp of components) {
    if (!incomingOf[comp.id] && outgoingOf[comp.id]) { startConn = outgoingOf[comp.id][0]; break }
  }
  if (!startConn) for (const comp of components) { if (outgoingOf[comp.id]) { startConn = outgoingOf[comp.id][0]; break } }
  if (!startConn) return {}
  const map: Record<string, number> = {}
  let counter = 1
  const visited = new Set<string>()
  let current: CanvasConnection | undefined = startConn
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    const key = `${current.from}:${current.fromPort}`
    if (!(key in map)) map[key] = counter++
    const nexts: CanvasConnection[] | undefined = outgoingOf[current.to]
    current = nexts?.find((n: CanvasConnection) => !visited.has(n.id))
  }
  for (const conn of connections) {
    if (!visited.has(conn.id)) { const key = `${conn.from}:${conn.fromPort}`; if (!(key in map)) map[key] = counter++ }
  }
  return map
}

export function inferCycleType(components: CanvasComponent[]): CycleType {
  const types = new Set(components.map(c => c.type))
  const has = (t: string) => types.has(t)
  if (has('compressor') && has('evaporator'))                return 'vapor_compression'
  if (has('compressor') && (has('turbine') || has('boiler'))) return 'brayton'
  if (has('turbine') || has('pump') || has('boiler'))        return 'rankine'
  return 'rankine'
}

interface CycleState {
  // Canvas
  components:  CanvasComponent[]
  connections: CanvasConnection[]
  past:   CanvasSnapshot[]
  future: CanvasSnapshot[]

  // Settings
  fluid:        string
  massFlowRate: number
  deadStateT0:  number
  deadStateP0:  number

  // Results
  canvasResults: any | null
  solverResults: SolveResponse | null
  solverScript:  string
  isLoading:     boolean
  error:         string | null

  // Persistence
  currentSimulationId: number | null
  simulationName:      string
  isDirty:             boolean

  // Mutations
  addComponent:    (c: Omit<CanvasComponent, 'id'>) => void
  updateComponent: (id: string, updates: Partial<CanvasComponent>) => void
  deleteComponent: (id: string) => void
  addConnection:   (c: Omit<CanvasConnection, 'id'>) => void
  deleteConnection:(id: string) => void
  clearCanvas:     () => void

  // Undo/redo
  undo: () => void
  redo: () => void

  // Setters
  setFluid:              (f: string) => void
  setMassFlowRate:       (m: number) => void
  setCanvasResults:      (r: any | null) => void
  setSolverResults:      (r: SolveResponse | null) => void
  setSolverScript:       (s: string) => void
  setLoading:            (v: boolean) => void
  setError:              (e: string | null) => void
  setSimulationName:     (n: string) => void
  markSaved:             (id: number, name: string) => void
  loadFromDB:            (sim: { id: number; name: string; fluid?: string; components: CanvasComponent[]; connections: CanvasConnection[] }) => void

  // Legacy alias so Dashboard doesn't break
  results: any | null
  setResults: (r: any | null) => void
}

let _id = 0
const uid = () => `c_${++_id}_${Date.now()}`
const MAX_HISTORY = 50

function snapshot(s: CycleState): CanvasSnapshot {
  return {
    components:  s.components.map(c => ({ ...c, position: { ...c.position }, parameters: { ...c.parameters } })),
    connections: s.connections.map(cn => ({ ...cn })),
  }
}
function pushHistory(s: CycleState) {
  return { past: [...s.past, snapshot(s)].slice(-MAX_HISTORY), future: [] as CanvasSnapshot[] }
}

export const useCycleStore = create<CycleState>((set) => ({
  components: [], connections: [], past: [], future: [],
  fluid: 'Water', massFlowRate: 1.0, deadStateT0: 298.15, deadStateP0: 101_325.0,
  canvasResults: null, solverResults: null, solverScript: '',
  isLoading: false, error: null,
  currentSimulationId: null, simulationName: '', isDirty: false,

  // Legacy alias
  get results() { return (this as any).canvasResults },
  setResults: (r) => set({ canvasResults: r }),

  addComponent: (c) => set((s) => ({ ...pushHistory(s), components: [...s.components, { ...c, id: uid() }], isDirty: true })),
  updateComponent: (id, updates) => set((s) => ({ ...pushHistory(s), components: s.components.map(c => c.id === id ? { ...c, ...updates } : c), isDirty: true })),
  deleteComponent: (id) => set((s) => ({ ...pushHistory(s), components: s.components.filter(c => c.id !== id), connections: s.connections.filter(cn => cn.from !== id && cn.to !== id), isDirty: true })),
  addConnection:   (c) => set((s) => ({ ...pushHistory(s), connections: [...s.connections, { ...c, id: uid() }], isDirty: true })),
  deleteConnection:(id)=> set((s) => ({ ...pushHistory(s), connections: s.connections.filter(c => c.id !== id), isDirty: true })),
  clearCanvas: () => set((s) => ({ ...pushHistory(s), components: [], connections: [], canvasResults: null, currentSimulationId: null, simulationName: '', isDirty: false })),

  undo: () => set((s) => {
    if (s.past.length === 0) return s
    const prev = s.past[s.past.length - 1]
    return { components: prev.components, connections: prev.connections, past: s.past.slice(0, -1), future: [snapshot(s), ...s.future].slice(0, MAX_HISTORY) }
  }),
  redo: () => set((s) => {
    if (s.future.length === 0) return s
    const next = s.future[0]
    return { components: next.components, connections: next.connections, past: [...s.past, snapshot(s)].slice(-MAX_HISTORY), future: s.future.slice(1) }
  }),

  setFluid:          (f) => set((s) => ({ fluid: f, connections: s.connections.map(cn => ({ ...cn, fluid: f })), isDirty: true })),
  setMassFlowRate:   (m) => set({ massFlowRate: m, isDirty: true }),
  setCanvasResults:  (r) => set({ canvasResults: r }),
  setSolverResults:  (r) => set({ solverResults: r }),
  setSolverScript:   (s) => set({ solverScript: s }),
  setLoading:        (v) => set({ isLoading: v }),
  setError:          (e) => set({ error: e }),
  setSimulationName: (n) => set({ simulationName: n, isDirty: true }),
  markSaved:         (id, name) => set({ currentSimulationId: id, simulationName: name, isDirty: false }),
  loadFromDB: ({ id, name, fluid, components, connections }) =>
    set({ currentSimulationId: id, simulationName: name, fluid: fluid ?? 'Water', components, connections, past: [], future: [], isDirty: false, canvasResults: null }),
}))
