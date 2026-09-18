/**
 * ThermoBird v2 — Transient Results Panel
 *
 * Four sub-tabs:
 *   1. Energy & Efficiency   — η_thermal, η_exergy, W_net, Q_in vs time
 *   2. Entropy Generation    — Ṡ_gen per component vs time
 *   3. Exergy Destruction    — Ẋ_dest per component vs time
 *   4. Temperatures          — T_fluid_boiler, T_wall_boiler, T_fluid_condenser vs time
 *
 * All charts use Recharts <LineChart> — already in the project.
 * Design tokens: --tb-* CSS variables, matches Dashboard exactly.
 */
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import {
  Zap, Flame, BarChart2, Thermometer,
  Trash2, Download, ChevronRight,
} from 'lucide-react'
import type { TransientResult } from '../../store/transientStore'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a row-per-timepoint array for Recharts */
function buildRows(
  t: number[],
  series: Record<string, number[] | undefined>,
): Record<string, number>[] {
  return t.map((ti, i) => {
    const row: Record<string, number> = { t: Math.round(ti * 10) / 10 }
    for (const [k, arr] of Object.entries(series)) {
      if (arr) row[k] = Math.round((arr[i] ?? 0) * 1e5) / 1e5
    }
    return row
  })
}

const CHART_COLORS = ['#0ea5e9', '#f59e0b', '#6366f1', '#10b981', '#f43f5e', '#a78bfa']

function pct(v: number) { return `${(v * 100).toFixed(1)} %` }

// ── Custom tooltip ────────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label, unit }: any) {
  if (!active || !payload?.length) return null
  return (
    <div
      className="rounded-xl p-3 text-xs shadow-xl"
      style={{
        background: 'var(--tb-bg-surface)',
        border: '1px solid var(--tb-border)',
        minWidth: 140,
      }}
    >
      <p className="mb-1.5 font-semibold" style={{ color: 'var(--tb-text-muted)' }}>
        t = {label} s
      </p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-3">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="font-mono font-semibold" style={{ color: 'var(--tb-text-primary)' }}>
            {p.value} {unit}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, unit, color }: { label: string; value: string; unit?: string; color: string }) {
  return (
    <div
      className="rounded-xl p-3.5 flex flex-col gap-1"
      style={{ background: 'var(--tb-bg-surface)', border: '1px solid var(--tb-border)' }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--tb-text-muted)' }}>
        {label}
      </p>
      <p className="text-xl font-bold font-mono" style={{ color, fontFamily: 'Outfit, monospace' }}>
        {value}
        {unit && <span className="text-xs font-normal ml-1" style={{ color: 'var(--tb-text-muted)' }}>{unit}</span>}
      </p>
    </div>
  )
}

// ── Chart wrapper ─────────────────────────────────────────────────────────────

function TimeChart({
  data, lines, unit, yLabel,
}: {
  data: Record<string, number>[]
  lines: { key: string; label: string; color: string }[]
  unit?: string
  yLabel?: string
}) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 24, left: 12, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--tb-border-soft)" />
        <XAxis
          dataKey="t"
          tick={{ fill: 'var(--tb-text-muted)', fontSize: 10 }}
          tickLine={false}
          axisLine={{ stroke: 'var(--tb-border)' }}
          label={{ value: 'Time (s)', position: 'insideBottomRight', offset: -4, fill: 'var(--tb-text-muted)', fontSize: 10 }}
        />
        <YAxis
          tick={{ fill: 'var(--tb-text-muted)', fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          label={yLabel ? { value: yLabel, angle: -90, position: 'insideLeft', fill: 'var(--tb-text-muted)', fontSize: 10 } : undefined}
          width={50}
        />
        <Tooltip content={<CustomTooltip unit={unit} />} />
        <Legend
          wrapperStyle={{ fontSize: 11, color: 'var(--tb-text-secondary)' }}
          iconType="circle"
          iconSize={7}
        />
        {lines.map(l => (
          <Line
            key={l.key}
            type="monotone"
            dataKey={l.key}
            name={l.label}
            stroke={l.color}
            strokeWidth={1.8}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

// ── Tab definitions ───────────────────────────────────────────────────────────

const TABS = [
  { id: 0, label: 'Energy & Efficiency', icon: <Zap       className="w-3.5 h-3.5" /> },
  { id: 1, label: 'Entropy Generation',  icon: <Flame     className="w-3.5 h-3.5" /> },
  { id: 2, label: 'Exergy Destruction',  icon: <BarChart2 className="w-3.5 h-3.5" /> },
  { id: 3, label: 'Temperatures',        icon: <Thermometer className="w-3.5 h-3.5" /> },
]

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  result:   TransientResult
  onClear: () => void
}

export default function TransientResults({ result, onClear }: Props) {
  const [activeTab, setActiveTab] = useState(0)

  const { t, variables: vars, derived, metadata } = result

  // ── Steady-state summary (last 10% of sim) ────────────────────────────────
  const ssIdx   = Math.floor(t.length * 0.9)
  const ssSlice = <K extends string>(key: K, arr: number[] | undefined) =>
    arr ? arr.slice(ssIdx).reduce((a, v) => a + v, 0) / arr.slice(ssIdx).length : 0

  const ss_eta_th  = ssSlice('eta_thermal',  derived.eta_thermal)
  const ss_eta_ex  = ssSlice('eta_exergy',   derived.eta_exergy)
  const ss_W_net   = ssSlice('W_net_kW',     derived.W_net_kW)
  const ss_Sgen    = ssSlice('Sgen_total_kW_K', derived.Sgen_total_kW_K)

  // ── Chart data ────────────────────────────────────────────────────────────

  const energyData = buildRows(t, {
    eta_thermal: derived.eta_thermal,
    eta_exergy:  derived.eta_exergy,
  })

  const powerData = buildRows(t, {
    W_net_kW: derived.W_net_kW,
    Q_in_kW:  derived.Q_in_kW,
  })

  const entropyData = buildRows(t, {
    Sgen_turbine_kW_K: derived.Sgen_turbine_kW_K,
    Sgen_boiler_kW_K:  derived.Sgen_boiler_kW_K,
    Sgen_total_kW_K:   derived.Sgen_total_kW_K,
  })

  const exergyData = buildRows(t, {
    Xdest_turbine_kW: derived.Xdest_turbine_kW,
    Xdest_boiler_kW:  derived.Xdest_boiler_kW,
  })

  const tempData = buildRows(t, {
    T_fluid_boiler:    vars.T_fluid_boiler,
    T_wall_boiler:     vars.T_wall_boiler,
    T_fluid_condenser: vars.T_fluid_condenser,
  })

  // ── Export CSV ────────────────────────────────────────────────────────────
  const exportCSV = () => {
    const allKeys = [
      't',
      ...Object.keys(vars),
      ...Object.keys(derived),
    ]
    const header = allKeys.join(',')
    const rows   = t.map((ti, i) => {
      const vals = allKeys.map(k => {
        if (k === 't') return ti.toFixed(3)
        const arr = vars[k] ?? derived[k]
        return arr ? (arr[i] ?? '').toString() : ''
      })
      return vals.join(',')
    })
    const csv  = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a    = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `transient_result_job${result.job_id}.csv`,
    })
    a.click()
  }

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: 'var(--tb-bg-base)' }}>

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 flex items-center justify-between px-5 py-2.5"
        style={{ borderBottom: '1px solid var(--tb-border)', background: 'var(--tb-bg-surface)' }}
      >
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4" style={{ color: 'var(--tb-accent)' }} />
          <span className="text-sm font-bold" style={{ color: 'var(--tb-text-primary)', fontFamily: 'Outfit, sans-serif' }}>
            Transient Results
          </span>
          {metadata && (
            <span className="text-xs" style={{ color: 'var(--tb-text-muted)' }}>
              · {metadata.n_steps} pts · {metadata.execution_ms} ms · {metadata.solver_nfev.toLocaleString()} fcn evals
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportCSV}
            className="tb-btn-ghost flex items-center gap-1.5 !text-xs !px-3 !py-1"
          >
            <Download className="w-3 h-3" /> Export CSV
          </button>
          <button
            onClick={onClear}
            className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-lg"
            style={{ color: '#f87171', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', cursor: 'pointer' }}
          >
            <Trash2 className="w-3 h-3" /> Clear
          </button>
        </div>
      </div>

      {/* ── Summary stats ───────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 grid grid-cols-4 gap-3 px-5 py-3"
        style={{ borderBottom: '1px solid var(--tb-border)', background: 'var(--tb-bg-elevated)' }}
      >
        <StatCard label="Thermal Efficiency (SS)" value={pct(ss_eta_th)} color="var(--tb-accent)" />
        <StatCard label="Exergy Efficiency (SS)"  value={pct(ss_eta_ex)} color="#818cf8" />
        <StatCard label="Net Power (SS)"          value={ss_W_net.toFixed(1)} unit="kW" color="#34d399" />
        <StatCard label="Total Ṡ_gen (SS)"        value={ss_Sgen > 0 ? ss_Sgen.toFixed(4) : '—'} unit="kW/K" color="#f59e0b" />
      </div>

      {/* ── Sub-tabs ─────────────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 flex items-end gap-0 px-5"
        style={{ borderBottom: '1px solid var(--tb-border)', background: 'var(--tb-bg-surface)' }}
      >
        {TABS.map(tab => {
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="relative flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium"
              style={{
                color: active ? 'var(--tb-accent)' : 'var(--tb-text-muted)',
                background: 'transparent', border: 'none', cursor: 'pointer', outline: 'none',
                transition: 'color 150ms ease',
              }}
            >
              {tab.icon}
              {tab.label}
              {active && (
                <motion.div
                  layoutId="transient-tab-indicator"
                  style={{
                    position: 'absolute', bottom: -1, left: 0, right: 0, height: 2,
                    background: 'linear-gradient(90deg, var(--tb-accent), #818cf8)',
                    borderRadius: '2px 2px 0 0',
                    boxShadow: '0 0 8px rgba(14,165,233,0.4)',
                  }}
                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                />
              )}
            </button>
          )
        })}
      </div>

      {/* ── Chart area ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <AnimatePresence mode="wait">

          {/* Tab 0 — Energy & Efficiency */}
          {activeTab === 0 && (
            <motion.div key="energy" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6">
              <ChartCard title="Thermal & Exergy Efficiency vs Time" subtitle="Steady-state approached as boiler heats up">
                <TimeChart
                  data={energyData}
                  unit=""
                  yLabel="Efficiency"
                  lines={[
                    { key: 'eta_thermal', label: 'η_thermal', color: '#0ea5e9' },
                    { key: 'eta_exergy',  label: 'ε_exergy',  color: '#818cf8' },
                  ]}
                />
              </ChartCard>
              <ChartCard title="Net Power & Heat Input vs Time" subtitle="kW — rises from zero as thermal mass heats">
                <TimeChart
                  data={powerData}
                  unit="kW"
                  yLabel="Power (kW)"
                  lines={[
                    { key: 'W_net_kW', label: 'W_net',  color: '#34d399' },
                    { key: 'Q_in_kW',  label: 'Q_in',   color: '#f59e0b' },
                  ]}
                />
              </ChartCard>
              <InsightCard color="#0ea5e9" text={
                `Steady-state thermal efficiency ≈ ${pct(ss_eta_th)}. ` +
                `The gap to the Carnot limit reflects irreversibilities in the boiler (temperature gap across heat transfer) and turbine (fluid friction).`
              } />
            </motion.div>
          )}

          {/* Tab 1 — Entropy Generation */}
          {activeTab === 1 && (
            <motion.div key="entropy" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6">
              <ChartCard title="Entropy Generation Rate vs Time" subtitle="kW/K — Gouy-Stodola: Ẋ_dest = T₀ · Ṡ_gen">
                <TimeChart
                  data={entropyData}
                  unit="kW/K"
                  yLabel="Ṡ_gen (kW/K)"
                  lines={[
                    { key: 'Sgen_boiler_kW_K',  label: 'Boiler',  color: '#f59e0b' },
                    { key: 'Sgen_turbine_kW_K', label: 'Turbine', color: '#0ea5e9' },
                    { key: 'Sgen_total_kW_K',   label: 'Total',   color: '#f43f5e' },
                  ]}
                />
              </ChartCard>
              <InsightCard color="#f59e0b" text={
                `The boiler generates the most entropy — not the turbine. ` +
                `High-temperature combustion gases transfer heat across a large ΔT, irreversibly destroying exergy. ` +
                `This is why supercritical plants (P > 22 MPa) and regenerators are thermodynamically justified.`
              } />
            </motion.div>
          )}

          {/* Tab 2 — Exergy Destruction */}
          {activeTab === 2 && (
            <motion.div key="exergy" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6">
              <ChartCard title="Exergy Destruction Rate vs Time" subtitle="kW — direct measure of lost work potential">
                <TimeChart
                  data={exergyData}
                  unit="kW"
                  yLabel="Ẋ_dest (kW)"
                  lines={[
                    { key: 'Xdest_boiler_kW',  label: 'Boiler',  color: '#f59e0b' },
                    { key: 'Xdest_turbine_kW', label: 'Turbine', color: '#0ea5e9' },
                  ]}
                />
              </ChartCard>
              <InsightCard color="#818cf8" text={
                `Exergy efficiency ≈ ${pct(ss_eta_ex)} at steady-state. ` +
                `${(100 * (1 - ss_eta_ex)).toFixed(1)}% of the available work potential is destroyed internally — ` +
                `predominantly in the boiler via heat transfer across a finite temperature difference.`
              } />
            </motion.div>
          )}

          {/* Tab 3 — Temperatures */}
          {activeTab === 3 && (
            <motion.div key="temps" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6">
              <ChartCard title="Component Temperatures vs Time" subtitle="K — startup transient showing thermal inertia">
                {tempData.some(r => r.T_fluid_boiler !== undefined || r.T_wall_boiler !== undefined) ? (
                  <TimeChart
                    data={tempData}
                    unit="K"
                    yLabel="Temperature (K)"
                    lines={[
                      { key: 'T_fluid_boiler',    label: 'Boiler fluid', color: '#f59e0b' },
                      { key: 'T_wall_boiler',     label: 'Boiler wall',  color: '#f43f5e' },
                      { key: 'T_fluid_condenser', label: 'Condenser',    color: '#6366f1' },
                    ].filter(l => tempData.some(r => r[l.key] !== undefined))}
                  />
                ) : (
                  <p className="text-sm text-center py-12" style={{ color: 'var(--tb-text-muted)' }}>
                    Temperature data not available for this configuration.
                  </p>
                )}
              </ChartCard>
              <InsightCard color="#f43f5e" text={
                `The boiler wall heats faster than the working fluid — thermal inertia causes a temperature lag. ` +
                `A heavier wall mass means a longer startup transient and more fuel consumed before net power output begins. ` +
                `This is operational knowledge that steady-state analysis cannot provide.`
              } />

              {/* Raw state variable table */}
              {Object.keys(vars).length > 0 && (
                <RawVarsTable vars={vars} t={t} />
              )}
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: 'var(--tb-bg-surface)', border: '1px solid var(--tb-border)' }}
    >
      <div className="px-5 pt-4 pb-2">
        <p className="text-sm font-semibold" style={{ color: 'var(--tb-text-primary)', fontFamily: 'Outfit, sans-serif' }}>
          {title}
        </p>
        {subtitle && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--tb-text-muted)' }}>{subtitle}</p>
        )}
      </div>
      <div className="px-2 pb-4">{children}</div>
    </div>
  )
}

function InsightCard({ text, color }: { text: string; color: string }) {
  return (
    <div
      className="flex items-start gap-3 p-4 rounded-xl text-xs leading-relaxed"
      style={{
        background: `${color}0d`,
        border: `1px solid ${color}30`,
      }}
    >
      <ChevronRight className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color }} />
      <p style={{ color: 'var(--tb-text-secondary)' }}>{text}</p>
    </div>
  )
}

function RawVarsTable({ vars, t }: { vars: Record<string, number[]>; t: number[] }) {
  const [expanded, setExpanded] = useState(false)
  const keys    = Object.keys(vars)
  const lastIdx = t.length - 1

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--tb-border)', background: 'var(--tb-bg-surface)' }}>
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold"
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--tb-text-secondary)' }}
      >
        <span>State Variables at t = {t[lastIdx]?.toFixed(1)} s (steady-state)</span>
        <span style={{ color: 'var(--tb-text-muted)' }}>{expanded ? '▲ Collapse' : '▼ Expand'}</span>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="grid grid-cols-2 md:grid-cols-3" style={{ borderTop: '1px solid var(--tb-border)' }}>
              {keys.map((k, i) => {
                const ssVal = vars[k]?.[lastIdx] ?? 0
                return (
                  <div
                    key={k}
                    className="flex items-center justify-between px-4 py-2"
                    style={{ borderBottom: '1px solid var(--tb-border-soft)', background: i % 2 === 0 ? 'var(--tb-bg-surface)' : 'var(--tb-bg-base)' }}
                  >
                    <span className="font-mono text-xs" style={{ color: 'var(--tb-accent)' }}>{k}</span>
                    <span className="font-mono text-xs font-semibold" style={{ color: 'var(--tb-text-primary)' }}>
                      {ssVal.toFixed(3)}
                    </span>
                  </div>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
