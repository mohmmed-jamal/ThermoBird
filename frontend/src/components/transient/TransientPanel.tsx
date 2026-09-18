/**
 * ThermoBird v2 — Transient Analysis Panel
 *
 * Smart panel that auto-detects and populates from Canvas or Solver.
 * No default components shown — source must be linked via the toggle.
 *
 * Header actions:
 *   Reload  — re-propagate from source (discards manual edits)
 *   Clear   — unlink source and wipe components entirely
 */
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Activity, Play, RotateCcw, ChevronDown, ChevronRight,
  Thermometer, Wind, Droplets, Zap, AlertTriangle,
  CheckCircle2, LayoutDashboard, Terminal, Settings2,
  Clock, ArrowRight, Trash2, Info,
} from 'lucide-react'
import {
  useTransientStore,
  type TransientComponentConfig,
  type TransientConnectionConfig,
  parseSolverScript,
} from '../../store/transientStore'
import { useTransientRunner } from './useTransientRunner'
import { useCycleStore } from '../../store/cycleStore'

// ── Component meta ────────────────────────────────────────────────────────────
const COMP_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  // ── Core power cycle ──────────────────────────────────────────────────────
  boiler:                    { label: 'Boiler / Steam Generator', icon: <Thermometer className="w-3.5 h-3.5" />, color: '#f59e0b' },
  turbine:                   { label: 'Turbine',                  icon: <Wind        className="w-3.5 h-3.5" />, color: '#0ea5e9' },
  condenser:                 { label: 'Condenser',                icon: <Droplets    className="w-3.5 h-3.5" />, color: '#6366f1' },
  pump:                      { label: 'Pump',                     icon: <Activity    className="w-3.5 h-3.5" />, color: '#10b981' },
  compressor:                { label: 'Compressor',               icon: <Zap         className="w-3.5 h-3.5" />, color: '#a78bfa' },
  evaporator:                { label: 'Evaporator',               icon: <Droplets    className="w-3.5 h-3.5" />, color: '#38bdf8' },
  heat_exchanger:            { label: 'Heat Exchanger',           icon: <Thermometer className="w-3.5 h-3.5" />, color: '#fb923c' },
  expansion_valve:           { label: 'Expansion Valve',          icon: <Wind        className="w-3.5 h-3.5" />, color: '#f43f5e' },
  recuperator:               { label: 'Recuperator',              icon: <Thermometer className="w-3.5 h-3.5" />, color: '#14b8a6' },
  // ── Absorption cycle ──────────────────────────────────────────────────────
  generator:                 { label: 'Generator / Desorber',     icon: <Zap         className="w-3.5 h-3.5" />, color: '#eab308' },
  absorber:                  { label: 'Absorber',                 icon: <Droplets    className="w-3.5 h-3.5" />, color: '#8b5cf6' },
  solution_pump:             { label: 'Solution Pump',            icon: <Activity    className="w-3.5 h-3.5" />, color: '#06b6d4' },
  // ── Solar / trigeneration ─────────────────────────────────────────────────
  heliostat_field:           { label: 'Heliostat Field',          icon: <Zap         className="w-3.5 h-3.5" />, color: '#fbbf24' },
  receiver:                  { label: 'Solar Receiver',           icon: <Thermometer className="w-3.5 h-3.5" />, color: '#f97316' },
  solar_receiver:            { label: 'Solar Receiver',           icon: <Thermometer className="w-3.5 h-3.5" />, color: '#f97316' },
  hrsg:                      { label: 'HRSG',                     icon: <Thermometer className="w-3.5 h-3.5" />, color: '#fb923c' },
  steam_turbine:             { label: 'Steam Turbine',            icon: <Wind        className="w-3.5 h-3.5" />, color: '#0ea5e9' },
  orc_turbine:               { label: 'ORC Turbine',              icon: <Wind        className="w-3.5 h-3.5" />, color: '#38bdf8' },
  orc_pump:                  { label: 'ORC Pump',                 icon: <Activity    className="w-3.5 h-3.5" />, color: '#34d399' },
  orc_condenser:             { label: 'ORC Condenser',            icon: <Droplets    className="w-3.5 h-3.5" />, color: '#818cf8' },
  solution_heat_exchanger:   { label: 'Solution HX',             icon: <Thermometer className="w-3.5 h-3.5" />, color: '#c084fc' },
  abs_generator:             { label: 'Abs. Generator',           icon: <Zap         className="w-3.5 h-3.5" />, color: '#eab308' },
}

const PARAM_META: Record<string, { label: string; unit: string; min: number; max: number; step: number }> = {
  Q_dot_kW:       { label: 'Heat input Q̇',      unit: 'kW',      min: 100,  max: 50000, step: 100  },
  UA_kW_K:        { label: 'Heat transfer UA',   unit: 'kW/K',    min: 1,    max: 500,   step: 1    },
  T_source_K:     { label: 'Source temperature', unit: 'K',       min: 400,  max: 2000,  step: 10   },
  mass_fluid:     { label: 'Fluid mass',         unit: 'kg',      min: 10,   max: 5000,  step: 10   },
  mass_wall:      { label: 'Wall mass',          unit: 'kg',      min: 50,   max: 10000, step: 50   },
  cp_wall:        { label: 'Wall specific heat', unit: 'J/kg·K',  min: 100,  max: 1000,  step: 10   },
  P_Pa:           { label: 'Pressure',           unit: 'Pa',      min: 1000, max: 3e7,   step: 10000},
  mass_flow:      { label: 'Mass flow rate',     unit: 'kg/s',    min: 0.1,  max: 100,   step: 0.1  },
  eta_isentropic: { label: 'Isentropic η',       unit: '',        min: 0.5,  max: 1.0,   step: 0.01 },
  T_sink_K:       { label: 'Sink temperature',   unit: 'K',       min: 273,  max: 400,   step: 1    },
  P_in_Pa:        { label: 'Inlet pressure',     unit: 'Pa',      min: 1000, max: 3e7,   step: 10000},
  P_out_Pa:       { label: 'Outlet pressure',    unit: 'Pa',      min: 1000, max: 3e7,   step: 10000},
}

const IC_META: Record<string, { label: string; unit: string; min: number; max: number }> = {
  T_fluid_boiler:    { label: 'Boiler fluid T₀',    unit: 'K', min: 270, max: 900 },
  T_wall_boiler:     { label: 'Boiler wall T₀',     unit: 'K', min: 270, max: 900 },
  T_fluid_condenser: { label: 'Condenser fluid T₀', unit: 'K', min: 270, max: 400 },
  T_pump_out:        { label: 'Pump outlet T₀',     unit: 'K', min: 270, max: 400 },
  omega_turbine:     { label: 'Turbine speed ω₀',   unit: 'rad/s', min: 0, max: 500 },
}

const SOLVER_METHODS = [
  { value: 'Auto',  label: 'Auto-select',      desc: 'Picks best method based on stiffness detection' },
  { value: 'Radau', label: 'Radau (implicit)', desc: 'Best for stiff systems — recommended for thermodynamics' },
  { value: 'RK45',  label: 'Runge-Kutta 4(5)', desc: 'Fast, explicit — good for smooth non-stiff systems' },
  { value: 'BDF',   label: 'BDF (implicit)',   desc: 'Very stiff systems, large time steps' },
  { value: 'LSODA', label: 'LSODA',            desc: 'Auto-switches between stiff/non-stiff adaptively' },
]

// ── Maps ANY canvas component type → transient config ─────────────────────────
// Handles all standard thermodynamic components. Unknown types are given a
// generic heat-exchanger config so they still appear in the panel.
function canvasCompToTransient(c: any, _fluid: string): TransientComponentConfig | null {
  const p    = c.parameters ?? {}
  const type = (c.type ?? '').toLowerCase().replace(/[\s-]/g, '_')  // normalise

  // ── Power cycle ────────────────────────────────────────────────────────────
  if (type === 'boiler' || type === 'heat_source' || type === 'steam_generator') return {
    id: c.id,
    type: 'boiler',
    params: {
      wall_mass:      p.wall_mass           ?? 2000,
      fluid_mass:     p.fluid_mass          ?? 500,
      cp_wall:        p.cp_wall             ?? 500,
      UA_source:      p.UA_source           ?? 5000,
      UA_fluid_wall:  p.UA_fluid_wall       ?? 2000,
      T_source:       p.source_temperature  ?? 900,
      P_Pa:           (p.pressure ?? p.inlet_pressure ?? 3000) * 1000,
      mass_flow:      p.mass_flow_rate      ?? 2.5,
    },
    initial_conditions: {
      T_fluid_boiler: p.inlet_temperature   ?? 320,
      T_wall_boiler:  (p.inlet_temperature  ?? 320) + 10,
    },
  }

  if (type === 'turbine' || type === 'steam_turbine' || type === 'gas_turbine') return {
    id: c.id,
    type: 'turbine',
    params: {
      eta_isentropic:    p.isentropic_efficiency ?? 0.85,
      rotor_inertia:     p.rotor_inertia         ?? 500,
      electrical_load_W: (p.power_output         ?? 500) * 1000,
    },
    initial_conditions: { omega_turbine: 0 },
  }

  if (type === 'condenser' || type === 'heat_sink') return {
    id: c.id,
    type: 'condenser',
    params: {
      fluid_mass:   p.fluid_mass    ?? 50,
      UA_condenser: p.UA_condenser  ?? 3000,
      T_sink:       p.sink_temperature ?? 298.15,
      P_Pa:         (p.pressure ?? p.outlet_pressure ?? 10) * 1000,
      mass_flow:    p.mass_flow_rate ?? 2.5,
    },
    initial_conditions: { T_fluid_condenser: p.inlet_temperature ?? 310 },
  }

  if (type === 'pump' || type === 'feed_pump') return {
    id: c.id,
    type: 'pump',
    params: { eta_isentropic: p.isentropic_efficiency ?? 0.80 },
    initial_conditions: { T_pump_out: p.outlet_temperature ?? 320 },
  }

  // ── Refrigeration / heat pump ──────────────────────────────────────────────
  if (type === 'compressor' || type === 'refrigeration_compressor') return {
    id: c.id,
    type: 'compressor',
    params: {
      eta_isentropic: p.isentropic_efficiency ?? 0.85,
      rotor_inertia:  p.rotor_inertia         ?? 20,
    },
    initial_conditions: { omega_compressor: 0 },
  }

  if (type === 'evaporator') return {
    id: c.id,
    type: 'evaporator',
    params: {
      fluid_mass:    p.fluid_mass        ?? 30,
      UA_evaporator: p.UA_evaporator     ?? 2000,
      T_source:      p.source_temperature ?? 278.15,
      P_Pa:          (p.pressure ?? p.inlet_pressure ?? 200) * 1000,
      mass_flow:     p.mass_flow_rate    ?? 0.5,
    },
    initial_conditions: { T_fluid_evaporator: p.inlet_temperature ?? 278 },
  }

  if (type === 'expansion_valve' || type === 'throttle_valve') return {
    id: c.id,
    type: 'expansion_valve',
    params: {},
    initial_conditions: {},
  }

  // ── Heat exchangers / recuperators ─────────────────────────────────────────
  if (type === 'heat_exchanger' || type === 'recuperator' || type === 'regenerator') return {
    id: c.id,
    type: type === 'heat_exchanger' ? 'heat_exchanger' : 'recuperator',
    params: {
      fluid_mass: p.fluid_mass ?? 100,
      UA_hx:      p.UA_hx     ?? 1500,
      mass_flow:  p.mass_flow_rate ?? 1.0,
    },
    initial_conditions: { T_fluid_hx: p.inlet_temperature ?? 400 },
  }

  // ── Absorption cycle ───────────────────────────────────────────────────────
  if (type === 'generator' || type === 'desorber') return {
    id: c.id,
    type: 'generator',
    params: {
      fluid_mass: p.fluid_mass       ?? 50,
      UA_gen:     p.UA_gen           ?? 1000,
      T_source:   p.source_temperature ?? 360,
      mass_flow:  p.mass_flow_rate   ?? 0.2,
    },
    initial_conditions: { T_fluid_generator: p.inlet_temperature ?? 340 },
  }

  if (type === 'absorber') return {
    id: c.id,
    type: 'absorber',
    params: {
      fluid_mass: p.fluid_mass       ?? 50,
      UA_abs:     p.UA_abs           ?? 800,
      T_sink:     p.sink_temperature ?? 308.15,
      mass_flow:  p.mass_flow_rate   ?? 0.2,
    },
    initial_conditions: { T_fluid_absorber: p.inlet_temperature ?? 308 },
  }

  if (type === 'solution_pump') return {
    id: c.id,
    type: 'solution_pump',
    params: { eta_isentropic: p.isentropic_efficiency ?? 0.80 },
    initial_conditions: {},
  }

  // ── Solar field / heliostat ───────────────────────────────────────────────
  if (type === 'heliostat_field' || type === 'solar_field') return {
    id: c.id,
    type: 'heat_exchanger',
    params: {
      fluid_mass: p.fluid_mass ?? 10,
      UA_hx:      p.UA_hx     ?? 800,
      mass_flow:  p.mass_flow_rate ?? 1.0,
      T_hot_in_K: p.source_temperature ?? 838,
      T_cold_in_K:p.inlet_temperature ?? 563,
    },
    initial_conditions: { T_hot_out: 800, T_cold_out: 600 },
  }

  // ── Molten-salt receiver ──────────────────────────────────────────────────
  if (type === 'receiver' || type === 'solar_receiver') return {
    id: c.id,
    type: 'boiler',
    params: {
      wall_mass:    p.wall_mass    ?? 2000,
      fluid_mass:   p.fluid_mass   ?? 500,
      cp_wall:      p.cp_wall      ?? 500,
      UA_source:    p.UA_source    ?? 5000,
      UA_fluid_wall:p.UA_fluid_wall ?? 2000,
      T_source:     p.source_temperature ?? 900,
      P_Pa:         (p.pressure ?? p.inlet_pressure ?? 3000) * 1000,
      mass_flow:    p.mass_flow_rate ?? 2.5,
    },
    initial_conditions: {
      T_fluid_boiler: p.inlet_temperature ?? 563,
      T_wall_boiler:  (p.inlet_temperature ?? 563) + 10,
    },
  }

  // ── HRSG ──────────────────────────────────────────────────────────────────
  if (type === 'hrsg') return {
    id: c.id,
    type: 'heat_exchanger',
    params: {
      fluid_mass: p.fluid_mass ?? 100,
      UA_hx:      p.UA_hx     ?? 1500,
      mass_flow:  p.mass_flow_rate ?? 1.0,
      T_hot_in_K: p.source_temperature ?? 700,
      T_cold_in_K:p.inlet_temperature  ?? 320,
    },
    initial_conditions: { T_hot_out: 500, T_cold_out: 350 },
  }

  // ── ORC turbine ───────────────────────────────────────────────────────────
  if (type === 'orc_turbine') return {
    id: c.id,
    type: 'turbine',
    params: {
      eta_isentropic:    p.isentropic_efficiency ?? 0.82,
      rotor_inertia:     p.rotor_inertia         ?? 50,
      electrical_load_W: (p.power_output         ?? 150) * 1000,
    },
    initial_conditions: { omega_turbine: 0 },
  }

  // ── ORC pump ─────────────────────────────────────────────────────────────
  if (type === 'orc_pump' || type === 'feedwater_pump') return {
    id: c.id,
    type: 'pump',
    params: { eta_isentropic: p.isentropic_efficiency ?? 0.78 },
    initial_conditions: { T_pump_out: p.outlet_temperature ?? 320 },
  }

  // ── ORC condenser ─────────────────────────────────────────────────────────
  if (type === 'orc_condenser') return {
    id: c.id,
    type: 'condenser',
    params: {
      fluid_mass:   p.fluid_mass    ?? 50,
      UA_condenser: p.UA_condenser  ?? 3000,
      T_sink:       p.sink_temperature ?? 298.15,
      P_Pa:         (p.pressure ?? p.outlet_pressure ?? 150) * 1000,
      mass_flow:    p.mass_flow_rate ?? 1.0,
    },
    initial_conditions: { T_fluid_condenser: p.inlet_temperature ?? 310 },
  }

  // ── Solution heat exchanger ───────────────────────────────────────────────
  if (type === 'solution_heat_exchanger' || type === 'she') return {
    id: c.id,
    type: 'heat_exchanger',
    params: {
      fluid_mass: p.fluid_mass ?? 40,
      UA_hx:      p.UA_hx     ?? 1200,
      mass_flow:  p.mass_flow_rate ?? 0.5,
    },
    initial_conditions: { T_hot_out: 360, T_cold_out: 320 },
  }

  // ── Absorption generator / desorber ──────────────────────────────────────
  if (type === 'abs_generator' || type === 'desorber') return {
    id: c.id,
    type: 'generator',
    params: {
      fluid_mass: p.fluid_mass        ?? 50,
      UA_gen:     p.UA_gen            ?? 1000,
      T_source:   p.source_temperature ?? 360,
      mass_flow:  p.mass_flow_rate    ?? 0.2,
    },
    initial_conditions: { T_fluid_generator: p.inlet_temperature ?? 340 },
  }

  // ── Steam turbine alias ───────────────────────────────────────────────────
  if (type === 'steam_turbine') return {
    id: c.id,
    type: 'turbine',
    params: {
      eta_isentropic:    p.isentropic_efficiency ?? 0.87,
      rotor_inertia:     p.rotor_inertia         ?? 500,
      electrical_load_W: (p.power_output         ?? 500) * 1000,
    },
    initial_conditions: { omega_turbine: 0 },
  }

  // ── Fallback: treat as generic heat exchanger so it still shows up ──────────
  console.warn(`[Transient] Unknown component type '${c.type}' — using generic HX config`)
  return {
    id: c.id,
    type: 'heat_exchanger',
    params: {
      fluid_mass: 100, UA_hx: 1000, mass_flow: 1.0,
    },
    initial_conditions: { T_fluid_hx: 400 },
  }
}

function canvasConnectionsToTransient(connections: any[]): TransientConnectionConfig[] {
  return connections.map(conn => ({
    from: conn.from,
    to: conn.to,
    from_port: conn.fromPort || 'outlet',
    to_port: conn.toPort || 'inlet',
  }))
}

// ── Slider + number input ─────────────────────────────────────────────────────
function ParamRow({
  label, unit, value, min, max, step, onChange,
}: {
  label: string; unit: string; value: number
  min: number; max: number; step: number
  onChange: (v: number) => void
}) {
  const [raw, setRaw] = useState(String(value))
  useEffect(() => { setRaw(String(value)) }, [value])

  const commit = () => {
    const n = parseFloat(raw)
    if (!isNaN(n)) onChange(Math.min(max, Math.max(min, n)))
    else setRaw(String(value))
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs" style={{ color: 'var(--tb-text-secondary)' }}>{label}</span>
        <div className="flex items-center gap-1">
          <input
            type="number" value={raw}
            onChange={e => setRaw(e.target.value)}
            onBlur={commit}
            onKeyDown={e => e.key === 'Enter' && commit()}
            className="tb-input text-right font-mono"
            style={{ width: 80, fontSize: 11, padding: '2px 6px', height: 24 }}
          />
          {unit && <span className="text-[10px]" style={{ color: 'var(--tb-text-muted)', minWidth: 36 }}>{unit}</span>}
        </div>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full"
        style={{ accentColor: 'var(--tb-accent)', height: 3 }}
      />
    </div>
  )
}

// ── Collapsible component card ────────────────────────────────────────────────
function ComponentCard({ idx }: { idx: number }) {
  const comp     = useTransientStore(s => s.config.components[idx])
  const setParam = useTransientStore(s => s.setComponentParam)
  const setIC    = useTransientStore(s => s.setComponentIC)
  const [open, setOpen] = useState(idx === 0)

  if (!comp) return null

  const meta        = COMP_META[comp.type] ?? { label: comp.type, icon: <Activity className="w-3.5 h-3.5" />, color: '#94a3b8' }
  const paramEntries = Object.entries(comp.params)
  const icEntries    = Object.entries(comp.initial_conditions)

  return (
    <div className="rounded-xl overflow-hidden"
         style={{ border: '1px solid var(--tb-border)', background: 'var(--tb-bg-surface)' }}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left"
        style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
      >
        <span style={{ color: meta.color }}>{meta.icon}</span>
        <span className="flex-1 text-sm font-semibold"
              style={{ color: 'var(--tb-text-primary)', fontFamily: 'Outfit, sans-serif' }}>
          {meta.label}
        </span>
        <span className="text-[10px] px-2 py-0.5 rounded-full"
              style={{ background: `${meta.color}18`, color: meta.color, border: `1px solid ${meta.color}30` }}>
          {comp.type}
        </span>
        {open
          ? <ChevronDown  className="w-3.5 h-3.5" style={{ color: 'var(--tb-text-muted)' }} />
          : <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--tb-text-muted)' }} />}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="px-3.5 pb-4 space-y-3"
                 style={{ borderTop: '1px solid var(--tb-border-soft)' }}>

              {paramEntries.length > 0 && (
                <div className="space-y-3 pt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest"
                     style={{ color: 'var(--tb-text-muted)' }}>Dynamic Parameters</p>
                  {paramEntries.map(([k, v]) => {
                    const m = PARAM_META[k]
                    if (!m) return (
                      <div key={k} className="flex items-center justify-between gap-2">
                        <span className="text-xs" style={{ color: 'var(--tb-text-secondary)' }}>{k}</span>
                        <input type="number" defaultValue={v} className="tb-input text-right font-mono"
                          style={{ width: 90, fontSize: 11, padding: '2px 6px', height: 24 }}
                          onBlur={e => setParam(idx, k, parseFloat(e.target.value) || (v as number))} />
                      </div>
                    )
                    return (
                      <ParamRow key={k}
                        label={m.label} unit={m.unit} value={v as number}
                        min={m.min} max={m.max} step={m.step}
                        onChange={n => setParam(idx, k, n)}
                      />
                    )
                  })}
                </div>
              )}

              {icEntries.length > 0 && (
                <div className="space-y-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-widest"
                     style={{ color: 'var(--tb-text-muted)' }}>Initial Conditions (t = 0)</p>
                  {icEntries.map(([k, v]) => {
                    const m = IC_META[k] ?? { label: k, unit: '', min: 0, max: 1000 }
                    return (
                      <ParamRow key={k}
                        label={m.label} unit={m.unit} value={v as number}
                        min={m.min} max={m.max} step={1}
                        onChange={n => setIC(idx, k, n)}
                      />
                    )
                  })}
                </div>
              )}

              {paramEntries.length === 0 && icEntries.length === 0 && (
                <p className="text-xs pt-3" style={{ color: 'var(--tb-text-muted)' }}>
                  No configurable dynamic parameters for this component.
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Progress bar ──────────────────────────────────────────────────────────────
function ProgressBar({ progress }: { progress: number }) {
  return (
    <div className="w-full rounded-full overflow-hidden" style={{ height: 5, background: 'var(--tb-bg-elevated)' }}>
      <motion.div
        animate={{ width: `${Math.round(progress * 100)}%` }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        style={{
          height: '100%', borderRadius: 0,
          background: 'linear-gradient(90deg, var(--tb-accent), #818cf8)',
          boxShadow: '0 0 8px rgba(14,165,233,0.5)',
        }}
      />
    </div>
  )
}

// ── Source banner ─────────────────────────────────────────────────────────────
function SourceBanner({ source }: { source: 'canvas' | 'solver' | null }) {
  if (source === 'canvas') return (
    <div className="flex items-center gap-3 p-3 rounded-xl"
         style={{ background: 'rgba(14,165,233,0.07)', border: '1px solid rgba(14,165,233,0.2)' }}>
      <LayoutDashboard className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--tb-accent)' }} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold" style={{ color: 'var(--tb-accent)' }}>Source: Canvas</p>
        <p className="text-xs" style={{ color: 'var(--tb-text-muted)' }}>
          Parameters auto-populated from canvas layout. Adjust thermal masses and ICs below.
        </p>
      </div>
      <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: '#34d399' }} />
    </div>
  )

  if (source === 'solver') return (
    <div className="flex items-center gap-3 p-3 rounded-xl"
         style={{ background: 'rgba(129,140,248,0.07)', border: '1px solid rgba(129,140,248,0.2)' }}>
      <Terminal className="w-4 h-4 flex-shrink-0" style={{ color: '#818cf8' }} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold" style={{ color: '#818cf8' }}>Source: Equation Solver</p>
        <p className="text-xs" style={{ color: 'var(--tb-text-muted)' }}>
          Linked from TBS script. Configure dynamic parameters and initial conditions below.
        </p>
      </div>
      <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: '#34d399' }} />
    </div>
  )

  return null
}

// ── No-source guidance panel ──────────────────────────────────────────────────
function NoSourceGuide() {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 gap-6">
      <div className="p-4 rounded-2xl" style={{ background: 'var(--tb-accent-subtle)', border: '1px solid var(--tb-accent-border)' }}>
        <Activity className="w-10 h-10" style={{ color: 'var(--tb-accent)' }} />
      </div>
      <div className="text-center max-w-sm">
        <p className="text-base font-bold mb-2"
           style={{ color: 'var(--tb-text-primary)', fontFamily: 'Outfit, sans-serif' }}>
          No model linked yet
        </p>
        <p className="text-sm" style={{ color: 'var(--tb-text-muted)', lineHeight: 1.7 }}>
          Transient analysis extends your existing model. Link from Canvas or Solver first.
        </p>
      </div>
      <div className="w-full max-w-sm space-y-2.5">
        {[
          { step: '1', icon: <LayoutDashboard className="w-3.5 h-3.5" />, text: 'Build your cycle on the Canvas tab' },
          { step: '2', icon: <Activity        className="w-3.5 h-3.5" />, text: 'Click the Steady State → Transient toggle in Canvas toolbar' },
          { step: '3', icon: <Settings2       className="w-3.5 h-3.5" />, text: 'Adjust thermal masses and initial conditions here' },
          { step: '4', icon: <Play            className="w-3.5 h-3.5" />, text: 'Run — results appear in Results → Transient' },
        ].map(({ step, icon, text }) => (
          <div key={step} className="flex items-center gap-3 p-2.5 rounded-xl"
               style={{ background: 'var(--tb-bg-surface)', border: '1px solid var(--tb-border)' }}>
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                  style={{ background: 'var(--tb-accent-subtle)', color: 'var(--tb-accent)', border: '1px solid var(--tb-accent-border)' }}>
              {step}
            </span>
            <span className="flex-shrink-0" style={{ color: 'var(--tb-text-muted)' }}>{icon}</span>
            <span className="text-xs" style={{ color: 'var(--tb-text-secondary)' }}>{text}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-center" style={{ color: 'var(--tb-text-muted)' }}>
        You can also link from the <strong style={{ color: 'var(--tb-text-secondary)' }}>Equation Solver</strong> tab
        using its Steady State → Transient toggle.
      </p>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function TransientPanel() {
  const config      = useTransientStore(s => s.config)
  const source      = useTransientStore(s => s.source)
  const jobStatus   = useTransientStore(s => s.jobStatus)
  const jobProgress = useTransientStore(s => s.jobProgress)
  const jobError    = useTransientStore(s => s.jobError)
  const setConfig   = useTransientStore(s => s.setConfig)
  const resetConfig = useTransientStore(s => s.resetConfig)

  const canvasComponents = useCycleStore(s => s.components)
  const canvasConnections = useCycleStore(s => s.connections)
  const canvasFluid      = useCycleStore(s => s.fluid)
  const canvasT0         = useCycleStore(s => s.deadStateT0)
  const canvasP0         = useCycleStore(s => s.deadStateP0)
  const solverScript     = useCycleStore(s => s.solverScript)

  const [showSolverSettings, setShowSolverSettings] = useState(true)
  const { runTransient } = useTransientRunner()

  const isRunning     = jobStatus === 'pending' || jobStatus === 'running'
  const hasFailed     = jobStatus === 'failed'
  const hasSource     = source !== null
  const hasComponents = config.components.length > 0
  const canRun        = hasComponents && !isRunning

  // ── Auto-propagate from canvas when source = 'canvas' ────────────────────
  useEffect(() => {
    if (source !== 'canvas') return

    // Always sync dead-state conditions from canvas global settings
    useTransientStore.setState(s => ({
      config: { ...s.config, T0: canvasT0, P0: canvasP0, fluid: canvasFluid || 'Water' },
    }))

    if (canvasComponents.length === 0) return

    const mapped = canvasComponents
      .map(c => canvasCompToTransient(c, canvasFluid || 'Water'))
      .filter((x): x is TransientComponentConfig => x !== null)

    if (mapped.length > 0) {
      useTransientStore.setState(s => ({
        config: {
          ...s.config,
          fluid:      canvasFluid || 'Water',
          T0:         canvasT0,
          P0:         canvasP0,
          components: mapped,
          connections: canvasConnectionsToTransient(canvasConnections),
        },
      }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, canvasComponents, canvasConnections, canvasFluid, canvasT0, canvasP0])

  // ── Auto-parse solver script via API ──────────────────────────────────────
  useEffect(() => {
    if (source !== 'solver' || !solverScript) return
    
    let cancelled = false
    
    parseSolverScript(solverScript)
      .then(result => {
        if (cancelled) return
        
        // Update config with parsed values
        useTransientStore.setState(s => ({
          config: {
            ...s.config,
            fluid: result.fluid || s.config.fluid,
            t_end: result.t_end || s.config.t_end,
            t_steps: result.t_steps || s.config.t_steps,
            components: result.components.length > 0 ? result.components : s.config.components,
            connections: result.connections || s.config.connections,
          },
        }))
        
        // Log any parse errors
        if (result.errors.length > 0) {
          console.warn('TBS parse warnings:', result.errors)
        }
      })
      .catch(err => {
        if (cancelled) return
        console.error('Failed to parse solver script:', err)
        // Fallback: try regex for fluid only
        const match = solverScript.match(/WorkingFluid\$\s*=\s*['"]([^'"]+)['"]/i)
        if (match) {
          useTransientStore.setState(s => ({
            config: { ...s.config, fluid: match[1] },
          }))
        }
      })
    
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, solverScript])

  // ── Reload: re-propagate from source (discards manual edits to params/ICs) ─
  const handleReload = () => {
    if (source === 'canvas' && canvasComponents.length > 0) {
      const mapped = canvasComponents
        .map(c => canvasCompToTransient(c, canvasFluid || 'Water'))
        .filter((x): x is TransientComponentConfig => x !== null)
      useTransientStore.setState(s => ({
        config: {
          ...s.config,
          fluid: canvasFluid || 'Water',
          components: mapped,
          connections: canvasConnectionsToTransient(canvasConnections),
        },
      }))
    } else {
      // Reset solver settings to defaults, keep components
      setConfig({
        t_end: 600, t_steps: 300, T0: 298.15,
        rtol: 1e-4, atol: 1e-6, solver_method: 'Auto', stiffness_detection: true,
      })
    }
  }

  // ── Clear: unlink source, wipe everything ─────────────────────────────────
  const handleClear = () => resetConfig()

  // ── If no source linked and no components, show guidance ─────────────────
  if (!hasSource && !hasComponents) {
    return (
      <div className="h-full" style={{ background: 'var(--tb-bg-base)' }}>
        <NoSourceGuide />
      </div>
    )
  }

  return (
    <div className="h-full flex overflow-hidden" style={{ background: 'var(--tb-bg-base)' }}>

      {/* ── Left: Configuration ──────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 flex flex-col overflow-y-auto"
        style={{ width: 360, borderRight: '1px solid var(--tb-border)', background: 'var(--tb-bg-surface)' }}
      >
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-3"
             style={{ borderBottom: '1px solid var(--tb-border)' }}>
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4" style={{ color: 'var(--tb-accent)' }} />
            <span className="text-sm font-bold"
                  style={{ color: 'var(--tb-text-primary)', fontFamily: 'Outfit, sans-serif' }}>
              Transient Configuration
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {/* Reload from source */}
            <button
              onClick={handleReload}
              title={source === 'canvas' ? 'Reload from canvas' : 'Reset settings to defaults'}
              className="tb-btn-ghost flex items-center gap-1 !px-2 !py-1 !text-xs"
            >
              <RotateCcw className="w-3 h-3" />
              {source === 'canvas' ? 'Reload' : 'Reset'}
            </button>
            {/* Clear + unlink */}
            <button
              onClick={handleClear}
              title="Clear model and unlink source"
              className="flex items-center gap-1 text-xs rounded-lg"
              style={{
                color: '#f87171',
                background: 'rgba(248,113,113,0.08)',
                border: '1px solid rgba(248,113,113,0.2)',
                cursor: 'pointer',
                padding: '4px 8px',
              }}
            >
              <Trash2 className="w-3 h-3" /> Clear
            </button>
          </div>
        </div>

        <div className="flex-1 p-4 space-y-4">

          {/* Source banner */}
          <SourceBanner source={source} />

          {/* Simulation settings */}
          <div className="rounded-xl p-3.5 space-y-3"
               style={{ border: '1px solid var(--tb-border)', background: 'var(--tb-bg-elevated)' }}>
            <p className="text-[10px] font-semibold uppercase tracking-widest"
               style={{ color: 'var(--tb-text-muted)' }}>Simulation Settings</p>

            {/* Auto-detected fluid (read-only) */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs" style={{ color: 'var(--tb-text-secondary)' }}>Working Fluid</span>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-xs font-semibold px-2.5 py-1 rounded"
                      style={{
                        background: 'var(--tb-accent-subtle)',
                        color: 'var(--tb-accent)',
                        border: '1px solid var(--tb-accent-border)',
                      }}>
                  {config.fluid}
                </span>
                <span title="Auto-detected from Canvas or Solver">
                  <Info className="w-3 h-3" style={{ color: 'var(--tb-text-muted)' }} />
                </span>
              </div>
            </div>

            {/* Duration */}
            <ParamRow
              label="Simulation duration"
              unit="s"
              value={config.t_end}
              min={30} max={3600} step={30}
              onChange={v => setConfig({ t_end: v })}
            />

            {/* Output resolution */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs" style={{ color: 'var(--tb-text-secondary)' }}>
                <Clock className="w-3 h-3 inline mr-1" />Output resolution
              </span>
              <div className="flex items-center gap-1">
                <input
                  type="number" value={config.t_steps} min={50} max={2000} step={50}
                  onChange={e => setConfig({ t_steps: Math.round(Number(e.target.value)) })}
                  className="tb-input text-right font-mono"
                  style={{ width: 70, fontSize: 11, padding: '2px 6px', height: 24 }}
                />
                <span className="text-[10px]" style={{ color: 'var(--tb-text-muted)' }}>pts</span>
              </div>
            </div>

            {/* Dead state — show sync source */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs" style={{ color: 'var(--tb-text-secondary)' }}>Dead-state T₀</span>
              <div className="flex items-center gap-1">
                <span className="font-mono text-xs" style={{ color: 'var(--tb-text-primary)' }}>
                  {config.T0.toFixed(2)} K
                </span>
                {source === 'canvas' && (
                  <span className="text-[9px] px-1 rounded"
                        style={{ background: 'var(--tb-accent-subtle)', color: 'var(--tb-accent)' }}>
                    canvas
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* ODE Solver settings */}
          <div className="rounded-xl overflow-hidden"
               style={{ border: '1px solid var(--tb-border)', background: 'var(--tb-bg-surface)' }}>
            <button
              onClick={() => setShowSolverSettings(v => !v)}
              className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              <Settings2 className="w-3.5 h-3.5" style={{ color: 'var(--tb-text-muted)' }} />
              <span className="flex-1 text-xs font-semibold" style={{ color: 'var(--tb-text-secondary)' }}>
                ODE Solver Settings
              </span>
              {showSolverSettings
                ? <ChevronDown  className="w-3.5 h-3.5" style={{ color: 'var(--tb-text-muted)' }} />
                : <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--tb-text-muted)' }} />}
            </button>

            <AnimatePresence initial={false}>
              {showSolverSettings && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.16 }}
                  style={{ overflow: 'hidden' }}
                >
                  <div className="px-3.5 pb-4 space-y-3"
                       style={{ borderTop: '1px solid var(--tb-border-soft)' }}>

                    <div className="pt-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-widest mb-2"
                         style={{ color: 'var(--tb-text-muted)' }}>Method</p>
                      <select
                        value={config.solver_method}
                        onChange={e => setConfig({ solver_method: e.target.value })}
                        className="tb-input w-full"
                        style={{ fontSize: 11, padding: '4px 8px', height: 30 }}
                      >
                        {SOLVER_METHODS.map(m => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                      {(() => {
                        const m = SOLVER_METHODS.find(x => x.value === config.solver_method)
                        return m ? (
                          <p className="text-[10px] mt-1.5" style={{ color: 'var(--tb-text-muted)' }}>
                            ⓘ {m.desc}
                          </p>
                        ) : null
                      })()}
                    </div>

                    {/* Auto stiffness detection toggle */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs" style={{ color: 'var(--tb-text-secondary)' }}>
                        Auto stiffness detection
                      </span>
                      <button
                        onClick={() => setConfig({ stiffness_detection: !config.stiffness_detection })}
                        className="w-9 h-5 rounded-full relative flex-shrink-0"
                        style={{
                          background: config.stiffness_detection ? 'var(--tb-accent)' : 'var(--tb-bg-elevated)',
                          border: '1px solid var(--tb-border)',
                          cursor: 'pointer',
                        }}
                      >
                        <span
                          className="absolute top-0.5 rounded-full"
                          style={{
                            width: 14, height: 14,
                            background: config.stiffness_detection ? '#fff' : 'var(--tb-text-muted)',
                            left: config.stiffness_detection ? 'calc(100% - 16px)' : 2,
                            transition: 'left 0.15s ease',
                          }}
                        />
                      </button>
                    </div>

                    {/* Tolerances */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-[10px] mb-1" style={{ color: 'var(--tb-text-muted)' }}>rtol</p>
                        <input
                          type="number" value={config.rtol} step={1e-5} min={1e-8}
                          onChange={e => setConfig({ rtol: parseFloat(e.target.value) || config.rtol })}
                          className="tb-input w-full font-mono"
                          style={{ fontSize: 11, height: 26 }}
                        />
                      </div>
                      <div>
                        <p className="text-[10px] mb-1" style={{ color: 'var(--tb-text-muted)' }}>atol</p>
                        <input
                          type="number" value={config.atol} step={1e-7} min={1e-10}
                          onChange={e => setConfig({ atol: parseFloat(e.target.value) || config.atol })}
                          className="tb-input w-full font-mono"
                          style={{ fontSize: 11, height: 26 }}
                        />
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Component cards */}
          {hasComponents && (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-widest"
                 style={{ color: 'var(--tb-text-muted)' }}>
                Components ({config.components.length})
              </p>
              <div className="space-y-2">
                {config.components.map((_, i) => <ComponentCard key={i} idx={i} />)}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Right: Status + run ──────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center p-8 gap-5">

        <motion.div layout className="w-full max-w-lg rounded-2xl p-6 space-y-5"
          style={{
            background: 'var(--tb-bg-surface)',
            border: '1px solid var(--tb-border)',
            boxShadow: 'var(--tb-panel-inset)',
          }}>

          {/* Title */}
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl"
                 style={{ background: 'var(--tb-accent-subtle)', border: '1px solid var(--tb-accent-border)' }}>
              <Activity className="w-5 h-5" style={{ color: 'var(--tb-accent)' }} />
            </div>
            <div>
              <p className="text-base font-bold"
                 style={{ color: 'var(--tb-text-primary)', fontFamily: 'Outfit, sans-serif' }}>
                Transient Simulation
              </p>
              <p className="text-xs" style={{ color: 'var(--tb-text-muted)' }}>
                {config.fluid} · {config.t_end} s · {config.components.length} component{config.components.length !== 1 ? 's' : ''} · {config.solver_method}
              </p>
            </div>
          </div>

          {/* Status area */}
          <AnimatePresence mode="wait">
            {isRunning && (
              <motion.div key="running"
                initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="space-y-2.5"
              >
                <div className="flex items-center justify-between text-xs" style={{ color: 'var(--tb-text-muted)' }}>
                  <span className="font-medium" style={{ color: 'var(--tb-accent)' }}>
                    {jobStatus === 'pending' ? 'Queuing job…' : 'Integrating ODE system…'}
                  </span>
                  <span className="font-mono">{Math.round(jobProgress * 100)}%</span>
                </div>
                <ProgressBar progress={jobProgress} />
                <p className="text-xs text-center" style={{ color: 'var(--tb-text-muted)' }}>
                  {config.solver_method === 'Radau' || config.solver_method === 'Auto'
                    ? 'Implicit stiff solver (Radau) — robust for thermodynamic systems'
                    : `Explicit ${config.solver_method} solver running…`
                  } · typically 10–60 s
                </p>
              </motion.div>
            )}

            {hasFailed && (
              <motion.div key="failed"
                initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="flex items-start gap-2.5 p-3 rounded-xl text-xs"
                style={{ background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.25)' }}
              >
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: '#f87171' }} />
                <div>
                  <p className="font-semibold" style={{ color: '#f87171' }}>Simulation failed</p>
                  <p className="mt-0.5" style={{ color: '#fca5a5' }}>{jobError ?? 'Unknown error.'}</p>
                </div>
              </motion.div>
            )}

            {jobStatus === 'idle' && (
              <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <p className="text-[10px] font-semibold uppercase tracking-widest mb-3"
                   style={{ color: 'var(--tb-text-muted)' }}>
                  This analysis computes
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { icon: '⚡', label: 'Energy interactions',   sub: 'Q̇, Ẇ_net, η_thermal vs time' },
                    { icon: '♻️', label: 'Exergy destruction',    sub: 'Ẋ_dest per component (kW)' },
                    { icon: '🌡️', label: 'Entropy generation',    sub: 'Ṡ_gen · Gouy-Stodola theorem' },
                    { icon: '📈', label: 'Startup transient',     sub: 'T(t), thermal inertia evolution' },
                    { icon: '🔄', label: 'Exergy efficiency',     sub: 'ε = W_net / Ẋ_fuel' },
                    { icon: '📊', label: 'COP (refrigeration)',   sub: 'Auto-detected cycle type' },
                  ].map(item => (
                    <div key={item.label} className="flex items-start gap-2 p-2.5 rounded-lg"
                         style={{ background: 'var(--tb-bg-elevated)', border: '1px solid var(--tb-border-soft)' }}>
                      <span className="text-base leading-none">{item.icon}</span>
                      <div>
                        <p className="text-xs font-semibold" style={{ color: 'var(--tb-text-primary)' }}>{item.label}</p>
                        <p className="text-[10px]" style={{ color: 'var(--tb-text-muted)' }}>{item.sub}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Run button */}
          <motion.button
            onClick={() => {
              if (!canRun) {
                alert('Cannot run: ' + (isRunning ? 'Already running' : 'No components configured'));
                return;
              }
              runTransient();
            }}
            disabled={!canRun}
            whileHover={canRun ? { scale: 1.02 } : {}}
            whileTap={canRun ? { scale: 0.97 } : {}}
            className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold ${
              !canRun ? 'tb-btn-ghost opacity-50 cursor-not-allowed' : 'tb-btn-primary'
            }`}
          >
            {isRunning ? (
              <>
                <svg className="tb-animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                Running Transient Simulation…
              </>
            ) : (
              <>
                <Play className="w-4 h-4" fill="currentColor" />
                Run Transient Simulation
                <ArrowRight className="w-3.5 h-3.5 opacity-60" />
              </>
            )}
          </motion.button>
        </motion.div>

        <p className="text-xs text-center max-w-md" style={{ color: 'var(--tb-text-muted)', lineHeight: 1.7 }}>
          Results open automatically in{' '}
          <strong style={{ color: 'var(--tb-text-secondary)' }}>Results → Transient</strong>{' '}
          with time-series plots, exergy breakdown, and entropy generation rates.
        </p>
      </div>
    </div>
  )
}
