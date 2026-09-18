/**
 * ResultsPanel — full cycle analysis output  v2
 * Proper spacing, font hierarchy, edge-shaded panels, light-mode-friendly colours.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { TrendingUp, Zap, Snowflake, Gauge, Thermometer, Activity, Download, FileText } from 'lucide-react';
import { exportCanvasCSV, exportCanvasPDF } from '../../lib/exportUtils';
import { useCycleStore } from '../../store/cycleStore';

interface ResultsPanelProps { results: any; }

export default function ResultsPanel({ results }: ResultsPanelProps) {
  const fluid          = useCycleStore(s => s.fluid);
  const simulationName = useCycleStore(s => s.simulationName) || 'simulation';
  const components     = useCycleStore(s => s.components);
  const connections    = useCycleStore(s => s.connections);

  if (!results || !results.success) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{
          padding: '14px 18px', borderRadius: 0,
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
        }}>
          <p style={{ fontSize: 13.5, fontWeight: 700, color: '#f87171', marginBottom: 4 }}>
            Simulation Error
          </p>
          <p style={{ fontSize: 13, color: '#fca5a5' }}>
            {results?.error_message || 'Unknown error'}
          </p>
        </div>
      </div>
    );
  }

  const perf  = results.performance       ?? {};
  const eb    = results.energy_balance    ?? {};
  const entr  = results.entropy           ?? {};
  const exrg  = results.exergy            ?? {};
  const comps = results.component_metrics ?? [];
  const spts  = results.state_points      ?? [];
  const warn  = results.warnings          ?? [];
  const comm  = results.commentary        ?? {};
  const isCOP = perf.cop_cooling != null;

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18,
                  background: 'var(--tb-bg-base)', minHeight: '100%' }}>

      {/* ── Export toolbar ───────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button
          onClick={() => exportCanvasCSV(results, fluid, simulationName)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px',
                   borderRadius: 0, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                   background: 'var(--tb-bg-elevated)', color: 'var(--tb-text-secondary)',
                   border: '1px solid var(--tb-border)' }}
        >
          <Download size={12} /> Export CSV
        </button>
        <button
          onClick={() => exportCanvasPDF(results, fluid, simulationName, components, connections)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 14px',
                   borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                   background: 'linear-gradient(135deg, var(--tb-accent), #818cf8)',
                   color: '#fff', border: 'none' }}
        >
          <FileText size={12} /> Export PDF
        </button>
      </div>

      {/* 1. KPIs */}
      <Panel title="Performance Metrics">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          {isCOP ? (<>
            <Kpi icon={<Snowflake  size={15}/>} label="COP (Cooling)"      color="#38bdf8" value={fmt(perf.cop_cooling, 3)} />
            <Kpi icon={<Gauge      size={15}/>} label="COP (Carnot)"       color="#a78bfa" value={fmt(perf.cop_carnot, 3)} />
            <Kpi icon={<Zap        size={15}/>} label="Cooling Capacity"   color="#34d399" value={kW(perf.cooling_capacity_kW)} />
            <Kpi icon={<TrendingUp size={15}/>} label="η Exergy (2nd Law)" color="#fb923c" value={pct(perf.second_law_efficiency)} />
          </>) : (<>
            <Kpi icon={<TrendingUp size={15}/>} label="η Thermal"          color="#38bdf8" value={pct(perf.thermal_efficiency)} />
            <Kpi icon={<Gauge      size={15}/>} label="η Carnot"           color="#a78bfa" value={pct(perf.carnot_efficiency)} />
            <Kpi icon={<Zap        size={15}/>} label="Net Power"          color="#34d399" value={kW(perf.net_power_kW)} />
            <Kpi icon={<TrendingUp size={15}/>} label="η Exergy (2nd Law)" color="#fb923c" value={pct(exrg.exergy_efficiency ?? perf.second_law_efficiency)} />
          </>)}
        </div>
      </Panel>

      {/* 2. Diagrams */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {results.ts_diagram && !results.ts_diagram.note && (
          <Panel title="T-s Diagram">
            <CycleDiagram
              cycleX={results.ts_diagram.cycle?.s?.map((v: number) => v / 1000)}
              cycleY={results.ts_diagram.cycle?.T}
              labels={results.ts_diagram.cycle?.labels}
              satXLiq={results.ts_diagram.saturation?.s_liq?.map((v: number) => v / 1000)}
              satXVap={results.ts_diagram.saturation?.s_vap?.map((v: number) => v / 1000)}
              satY={results.ts_diagram.saturation?.T}
              xLabel="s [kJ/(kg·K)]"
              yLabel="T [K]"
              statePoints={spts}
            />
          </Panel>
        )}
        {results.ph_diagram && !results.ph_diagram.note && (
          <Panel title="P-h Diagram">
            <CycleDiagram
              cycleX={results.ph_diagram.cycle?.h?.map((v: number) => v / 1000)}
              cycleY={results.ph_diagram.cycle?.P?.map((v: number) => v / 1000)}
              labels={results.ph_diagram.cycle?.labels}
              satXLiq={results.ph_diagram.saturation?.h_liq?.map((v: number) => v / 1000)}
              satXVap={results.ph_diagram.saturation?.h_vap?.map((v: number) => v / 1000)}
              satY={results.ph_diagram.saturation?.P?.map((v: number) => v / 1000)}
              xLabel="h [kJ/kg]"
              yLabel="P [kPa]"
              logY statePoints={spts}
            />
          </Panel>
        )}
      </div>

      {/* 3. State Points */}
      {spts.length > 0 && (
        <Panel title="State Points">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr>
                  {['State','T (K)','T (°C)','P (kPa)','h (kJ/kg)','s (kJ/kg·K)','x','Phase'].map(h => (
                    <th key={h} style={{
                      textAlign: 'left', padding: '8px 12px', fontWeight: 700, fontSize: 10.5,
                      color: 'var(--tb-text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase',
                      borderBottom: '2px solid var(--tb-border)',
                      background: 'var(--tb-bg-elevated)',
                      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {spts.map((sp: any, i: number) => (
                  <tr key={i} className="tb-row" style={{
                    borderBottom: '1px solid var(--tb-border-soft)',
                    background: i % 2 === 0 ? 'var(--tb-bg-surface)' : 'var(--tb-bg-subtle)',
                  }}>
                    <td style={{ padding: '8px 12px', fontWeight: 700, color: 'var(--tb-accent)',
                                  fontFamily: 'monospace', fontSize: 12.5 }}>
                      {sp.label}
                    </td>
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12.5,
                                  fontWeight: 600, color: 'var(--tb-text-primary)' }}>{fmt(sp.T_K)}</td>
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12.5,
                                  color: 'var(--tb-text-secondary)' }}>{fmt(sp.T_C)}</td>
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12.5,
                                  fontWeight: 600, color: 'var(--tb-text-primary)' }}>{fmt(sp.P_kPa)}</td>
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12.5,
                                  fontWeight: 600, color: 'var(--tb-text-primary)' }}>{fmt(sp.h_kJ_kg)}</td>
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12.5,
                                  fontWeight: 600, color: 'var(--tb-text-primary)' }}>{fmt(sp.s_kJ_kgK, 4)}</td>
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12.5,
                                  color: 'var(--tb-text-secondary)' }}>
                      {sp.x != null ? sp.x.toFixed(3) : '—'}
                    </td>
                    <td style={{ padding: '8px 12px', fontWeight: 600, color: phaseColor(sp.phase), fontSize: 12 }}>
                      {sp.phase}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* 4. Component Analysis */}
      {comps.length > 0 && (
        <Panel title="Component Analysis">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {comps.map((c: any, i: number) => (
              <div key={i} style={{
                borderRadius: 8, border: '1px solid var(--tb-border)',
                overflow: 'hidden',
                boxShadow: 'var(--tb-panel-inset), var(--tb-shadow-sm)',
              }}>
                {/* Component header */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '9px 14px',
                  background: 'var(--tb-bg-elevated)',
                  borderBottom: '1px solid var(--tb-border)',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), inset 0 -1px 0 rgba(0,0,0,0.08)',
                }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--tb-text-primary)',
                                  fontFamily: 'Outfit, sans-serif' }}>
                    {c.name}
                  </span>
                  <span style={{
                    fontSize: 10, fontFamily: 'monospace', padding: '3px 9px', borderRadius: 0,
                    background: 'var(--tb-bg-base)', color: 'var(--tb-accent)',
                    border: '1px solid var(--tb-accent-border)', letterSpacing: '0.01em',
                  }}>
                    {COMPONENT_EQUATIONS[c.type] ?? c.type}
                  </span>
                </div>

                {/* Three columns */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}>
                  <CompCol title="Energy" color="#38bdf8">
                    {c.work_kW !== 0 && c.work_kW != null && <DataRow label="Ẇ" value={`${fmt(c.work_kW)} kW`} color={c.work_kW > 0 ? '#4ade80' : '#f87171'} />}
                    {c.heat_kW !== 0 && c.heat_kW != null && <DataRow label="Q̇" value={`${fmt(c.heat_kW)} kW`} color={c.heat_kW > 0 ? '#f87171' : '#60a5fa'} />}
                    {c.isentropic_efficiency != null && <DataRow label="η_is" value={pct(c.isentropic_efficiency)} color="#fbbf24" />}
                  </CompCol>
                  <CompCol title="Entropy Gen." color="#a78bfa" leftBorder>
                    <DataRow label="Ṡ_gen" value={`${fmt(c.entropy_gen_W_per_K, 4)} W/K`} color="#a78bfa" />
                    <DataRow label="Share" value={`${fmt(c.entropy_gen_share_pct, 1)}%`}   color="#a78bfa" />
                    <p style={{ fontSize: 9.5, marginTop: 6, fontFamily: 'monospace', color: 'var(--tb-text-muted)' }}>
                      Ṡ_gen = ṁ·(s_out − s_in)
                    </p>
                  </CompCol>
                  <CompCol title="Exergy Dest." color="#f87171" leftBorder>
                    <DataRow label="Ėx_dest" value={`${fmt(c.exergy_destruction_kW, 3)} kW`} color="#f87171" />
                    <DataRow label="Share"
                      value={`${fmt(exrg.component_breakdown?.find((b: any) => b.name === c.name)?.exergy_destruction_share, 1)}%`}
                      color="#f87171" />
                    <p style={{ fontSize: 9.5, marginTop: 6, fontFamily: 'monospace', color: 'var(--tb-text-muted)' }}>
                      Ėx_dest = T₀·Ṡ_gen
                    </p>
                  </CompCol>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* 5. Cycle Totals */}
      <Panel title="Cycle Totals">
        {eb.net_work_kW != null && (
          <div style={{ marginBottom: 16 }}>
            <SectionLabel icon={<Zap size={12}/>} color="#38bdf8">Energy Balance</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginBottom: 10 }}>
              <TotalCard label="Heat Input"    value={kW(eb.total_heat_input_kW)}  color="#f87171" />
              <TotalCard label="Heat Output"   value={kW(eb.total_heat_output_kW)} color="#60a5fa" />
              <TotalCard label="Work Input"    value={kW(eb.total_work_input_kW)}  color="#c084fc" />
              <TotalCard label="Work Output"   value={kW(eb.total_work_output_kW)} color="#4ade80" />
              <TotalCard label="Net Work"      value={kW(eb.net_work_kW)}          color="#38bdf8" />
              <TotalCard label="Balance Error"
                value={`${(eb.energy_balance_error_percent ?? 0).toFixed(3)}%`}
                color={eb.energy_balance_error_percent < 1 ? '#34d399' : '#fbbf24'} />
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '7px 12px',
              borderRadius: 8, borderLeft: `3px solid ${eb.is_balanced ? '#34d399' : '#fbbf24'}`,
              background: eb.is_balanced ? 'rgba(52,211,153,0.07)' : 'rgba(251,191,36,0.07)',
            }}>
              <span style={{ color: eb.is_balanced ? '#34d399' : '#fbbf24' }}>
                {eb.is_balanced ? '✓ Energy balance satisfied' : '⚠ Check inputs — energy balance error exceeds tolerance'}
              </span>
            </div>
          </div>
        )}

        <div style={{ height: 1, background: 'var(--tb-border)', margin: '14px 0' }} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {entr.total_Sgen_W_per_K != null && (
            <div>
              <SectionLabel icon={<Thermometer size={12}/>} color="#a78bfa">Total Entropy Generation</SectionLabel>
              <BigValueCard color="#a78bfa" label="Σ Ṡ_gen" value={fmt(entr.total_Sgen_W_per_K, 4)} unit="W/K"
                footnote={`Lost work = T₀·ΣṠ_gen = ${fmt(entr.total_Sgen_W_per_K * (results.T0 ?? 298.15) / 1e3, 3)} kW`} />
            </div>
          )}
          {exrg.total_exergy_destruction_kW != null && (
            <div>
              <SectionLabel icon={<Activity size={12}/>} color="#f87171">Total Exergy Destruction</SectionLabel>
              <BigValueCard color="#f87171" label="Σ Ėx_dest" value={fmt(exrg.total_exergy_destruction_kW, 3)} unit="kW"
                footnote={`η_exergy = ${pct(exrg.exergy_efficiency)}`} />
            </div>
          )}
        </div>
      </Panel>

      {/* 6. Entropy breakdown */}
      {entr.component_breakdown?.length > 0 && (
        <Panel title="Entropy Generation Breakdown">
          <div style={{
            fontSize: 10.5, fontFamily: 'monospace', marginBottom: 14, padding: '6px 12px',
            borderRadius: 8, background: 'var(--tb-bg-elevated)', color: '#a78bfa',
            border: '1px solid rgba(167,139,250,0.18)',
          }}>
            Ṡ_gen,i = ṁ·(s_out − s_in) ≥ 0 &nbsp;·&nbsp; Gouy-Stodola: Ẇ_lost = T₀·Ṡ_gen,total
          </div>
          <BreakdownBars items={entr.component_breakdown} valueKey="Sgen_W_per_K" shareKey="share_pct"
            color="#a78bfa" unit="W/K" dp={4} />
        </Panel>
      )}

      {/* 7. Exergy breakdown */}
      {exrg.component_breakdown?.length > 0 && (
        <Panel title="Exergy Destruction Breakdown">
          <div style={{
            fontSize: 10.5, fontFamily: 'monospace', marginBottom: 14, padding: '6px 12px',
            borderRadius: 0, background: 'var(--tb-bg-elevated)', color: '#f87171',
            border: '1px solid rgba(248,113,113,0.2)',
          }}>
            Ėx_dest,i = T₀·Ṡ_gen,i &nbsp;·&nbsp; η_ex = Ẇ_net / ΔĖx_source = {pct(exrg.exergy_efficiency)}
          </div>
          <BreakdownBars items={exrg.component_breakdown} valueKey="exergy_destruction_kW"
            shareKey="exergy_destruction_share" color="#f87171" unit="kW" dp={3} />
        </Panel>
      )}

      {/* 8. Commentary */}
      {(comm.summary || comm.performance_insights?.length || comm.improvement_suggestions?.length) && (
        <Panel title="Analysis">
          {comm.summary && (
            <p style={{ fontSize: 13.5, lineHeight: 1.7, color: 'var(--tb-text-secondary)', marginBottom: 14 }}>
              {comm.summary}
            </p>
          )}
          {comm.performance_insights?.length > 0 && (
            <InsightList title="Performance Insights" items={comm.performance_insights} bullet="•" color="var(--tb-accent)" />
          )}
          {comm.improvement_suggestions?.length > 0 && (
            <InsightList title="Suggestions" items={comm.improvement_suggestions} bullet="→" color="#34d399" />
          )}
        </Panel>
      )}

      {/* Warnings */}
      {warn.length > 0 && (
        <div style={{
          padding: '12px 16px', borderRadius: 0,
          background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.25)',
        }}>
          <p style={{ fontSize: 11.5, fontWeight: 700, color: '#fbbf24', marginBottom: 6 }}>Warnings</p>
          {warn.map((w: string, i: number) => (
            <p key={i} style={{ fontSize: 13, color: '#fcd34d', marginTop: 3 }}>⚠ {w}</p>
          ))}
        </div>
      )}

      <p style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--tb-text-muted)' }}>
        Analysis completed in {results.execution_time_ms} ms · ThermoBird
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const COMPONENT_EQUATIONS: Record<string, string> = {
  pump:            'ẇ_p = ṁ(h₂−h₁)/η_is',
  turbine:         'ẇ_t = ṁ·η_is·(h_in−h_out,s)',
  compressor:      'ẇ_c = ṁ(h₂ₛ−h₁)/η_is',
  boiler:          'Q̇_in = ṁ(h_out−h_in)',
  combustor:       'Q̇_in = ṁ(h_out−h_in)',
  condenser:       'Q̇_out = ṁ(h_in−h_out)',
  evaporator:      'Q̇_evap = ṁ(h_out−h_in)',
  heat_exchanger:  'Q̇ = ε·Ċ_min·(T_h,in−T_c,in)',
  expansion_valve: 'h_out = h_in  (isenthalpic)',
  regenerator:     'ε = Q̇_actual / Q̇_max',
  mixing_chamber:  'ṁ₁h₁ + ṁ₂h₂ = ṁ_out·h_out',
};

// ─────────────────────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────────────────────

function fmt(v: any, dp = 2): string {
  if (v == null || (typeof v === 'number' && isNaN(v))) return '—';
  return Number(v).toFixed(dp);
}
function pct(v: any): string { return v != null ? `${(Number(v) * 100).toFixed(1)}%` : '—'; }
function kW(v: any): string  { return v != null ? `${Number(v).toFixed(2)} kW` : '—'; }
function phaseColor(p: string): string {
  if (!p) return 'var(--tb-text-muted)';
  if (p.includes('two'))                            return '#7c3aed';
  if (p.includes('sup'))                            return '#dc2626';
  if (p === 'liquid' || p.includes('liquid'))       return '#0369a1';
  if (p.includes('gas') || p.includes('vapor'))     return '#c2410c';
  return 'var(--tb-text-secondary)';
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      borderRadius: 0, border: '1px solid var(--tb-border)',
      background: 'var(--tb-bg-surface)',
      boxShadow: 'var(--tb-panel-inset), var(--tb-panel-shadow)',
      overflow: 'hidden',
    }}>
      {/* Panel header with edge shading */}
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid var(--tb-border)',
        background: 'var(--tb-bg-elevated)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.08)',
      }}>
        <h3 style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
          color: 'var(--tb-text-muted)', margin: 0, fontFamily: 'Inter, sans-serif',
        }}>
          {title}
        </h3>
      </div>
      <div style={{ padding: '16px 16px' }}>
        {children}
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  if (!value || value === '—') return null;
  return (
    <div className="tb-kpi-card" style={{
      borderRadius: 10, padding: '14px 16px',
      background: `color-mix(in srgb, ${color} 8%, var(--tb-bg-surface))`,
      border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
      boxShadow: 'var(--tb-panel-inset)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10, color }}>
        {icon}
        <p style={{ fontSize: 11, fontWeight: 600, margin: 0, color: 'var(--tb-text-secondary)',
                     letterSpacing: '0.03em' }}>
          {label}
        </p>
      </div>
      <p style={{ fontSize: 22, fontWeight: 800, margin: 0, color: 'var(--tb-text-primary)',
                   fontFamily: 'Outfit, monospace', letterSpacing: '-0.02em' }}>
        {value}
      </p>
    </div>
  );
}

function TotalCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      padding: '10px 13px', borderRadius: 9,
      background: `color-mix(in srgb, ${color} 7%, var(--tb-bg-surface))`,
      border: `1px solid color-mix(in srgb, ${color} 22%, transparent)`,
      boxShadow: 'var(--tb-panel-inset)',
    }}>
      <p style={{ fontSize: 11, color: 'var(--tb-text-muted)', marginBottom: 5, fontWeight: 600,
                   letterSpacing: '0.03em' }}>
        {label}
      </p>
      <p style={{ fontSize: 15, fontWeight: 700, fontFamily: 'monospace', color: 'var(--tb-text-primary)', margin: 0 }}>
        {value}
      </p>
    </div>
  );
}

function BigValueCard({ color, label, value, unit, footnote }:
  { color: string; label: string; value: string; unit: string; footnote: string }) {
  return (
    <div style={{
      padding: '12px 14px', borderRadius: 10, marginTop: 8,
      background: `color-mix(in srgb, ${color} 7%, var(--tb-bg-surface))`,
      border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
      boxShadow: 'var(--tb-panel-inset)',
    }}>
      <p style={{ fontSize: 11, color: 'var(--tb-text-muted)', marginBottom: 4,
                   fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        {label}
      </p>
      <p style={{ fontSize: 24, fontWeight: 800, fontFamily: 'monospace', margin: 0,
                   color: 'var(--tb-text-primary)', letterSpacing: '-0.02em' }}>
        {value}
        <span style={{ fontSize: 13, fontWeight: 400, marginLeft: 5, color: 'var(--tb-text-muted)' }}>{unit}</span>
      </p>
      <p style={{ fontSize: 10, marginTop: 6, fontFamily: 'monospace', color: 'var(--tb-text-muted)',
                   opacity: 0.85 }}>
        {footnote}
      </p>
    </div>
  );
}

function SectionLabel({ icon, color, children }: { icon: React.ReactNode; color: string; children: React.ReactNode }) {
  return (
    <p style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700,
                 color, marginBottom: 10, marginTop: 0 }}>
      <span style={{ color }}>{icon}</span>
      {children}
    </p>
  );
}

function CompCol({ title, color, children, leftBorder }: {
  title: string; color: string; children: React.ReactNode; leftBorder?: boolean;
}) {
  return (
    <div style={{
      padding: '12px 14px',
      borderLeft: leftBorder ? '1px solid var(--tb-border)' : undefined,
      background: 'var(--tb-bg-surface)',
    }}>
      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase',
                   color, marginBottom: 10 }}>
        {title}
      </p>
      {children}
    </div>
  );
}

function DataRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                   padding: '4px 0', fontSize: 12.5 }}>
      <span style={{ fontSize: 12, color: 'var(--tb-text-muted)', fontWeight: 500 }}>{label}</span>
      <span style={{ fontFamily: 'monospace', fontWeight: 700, color, fontSize: 12.5 }}>{value}</span>
    </div>
  );
}

function InsightList({ title, items, bullet, color }: {
  title: string; items: string[]; bullet: string; color: string;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <p style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--tb-text-muted)', marginBottom: 8, letterSpacing: '0.04em' }}>
        {title}
      </p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
        {items.map((item: string, i: number) => (
          <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13.5,
                                lineHeight: 1.6, color: 'var(--tb-text-secondary)' }}>
            <span style={{ color, flexShrink: 0, fontWeight: 700 }}>{bullet}</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function BreakdownBars({ items, valueKey, shareKey, color, unit, dp = 2 }:
  { items: any[]; valueKey: string; shareKey: string; color: string; unit: string; dp?: number }) {
  const max = Math.max(...items.map((x: any) => x[shareKey] ?? 0), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {items.map((item: any, i: number) => (
        <div key={i}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 5 }}>
            <span style={{ color: 'var(--tb-text-secondary)', fontWeight: 500 }}>{item.name}</span>
            <span style={{ fontFamily: 'monospace', color, fontWeight: 700 }}>
              {Number(item[valueKey]).toFixed(dp)} {unit}
              <span style={{ color: 'var(--tb-text-muted)', fontWeight: 400 }}>
                {' '}({Number(item[shareKey]).toFixed(1)}%)
              </span>
            </span>
          </div>
          <div style={{ height: 7, borderRadius: 0, background: 'var(--tb-bg-elevated)',
                         border: '1px solid var(--tb-border-soft)', overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 99,
              width: `${(item[shareKey] / max) * 100}%`,
              background: color, opacity: 0.72,
              transition: 'width 400ms ease',
            }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CycleDiagram — interactive zoom/pan + hover tooltips
// ─────────────────────────────────────────────────────────────────────────────

function CycleDiagram({
  cycleX, cycleY, labels, satXLiq, satXVap, satY,
  xLabel, yLabel, logY = false, statePoints = [],
}: {
  cycleX?: number[]; cycleY?: number[]; labels?: string[];
  satXLiq?: number[]; satXVap?: number[]; satY?: number[];
  xLabel: string; yLabel: string; logY?: boolean; statePoints?: any[];
}) {
  const [zoom, setZoom]       = useState(1);
  const [pan, setPan]         = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ mx: 0, my: 0, px: 0, py: 0 });
  const [hovered, setHovered] = useState<number | null>(null);

  const resetView = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, []);
  const onWheel   = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.min(8, Math.max(0.5, z * (e.deltaY < 0 ? 1.15 : 0.87))));
  }, []);
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsPanning(true);
    panStart.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y };
  }, [pan]);
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    setPan({ x: panStart.current.px + (e.clientX - panStart.current.mx), y: panStart.current.py + (e.clientY - panStart.current.my) });
  }, [isPanning]);
  const onMouseUp = useCallback(() => setIsPanning(false), []);

  const VW = 500, VH = 300;
  const PAD = { l: 58, r: 20, t: 16, b: 42 };
  const iW  = VW - PAD.l - PAD.r;
  const iH  = VH - PAD.t - PAD.b;

  if (!cycleX?.length || !cycleY?.length) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                     height: 140, fontSize: 12, borderRadius: 8,
                     background: 'var(--tb-bg-elevated)', color: 'var(--tb-text-muted)' }}>
        No diagram data
      </div>
    );
  }

  const allX = [...cycleX, ...(satXLiq ?? []), ...(satXVap ?? [])].filter(v => isFinite(v));
  const allY = [...cycleY, ...(satY ?? [])].filter(v => isFinite(v) && (!logY || v > 0));
  const xMin = Math.min(...allX), xMax = Math.max(...allX);
  const yMin = Math.min(...allY), yMax = Math.max(...allY);
  const xSpan = xMax - xMin || 1, ySpan = yMax - yMin || 1;
  const xLo = xMin - xSpan * 0.07, xHi = xMax + xSpan * 0.07;
  const yLo = logY ? yMin * 0.65 : yMin - ySpan * 0.07;
  const yHi = logY ? yMax * 1.55 : yMax + ySpan * 0.07;
  const lyLo = logY ? Math.log10(Math.max(yLo, 1e-9)) : 0;
  const lyHi = logY ? Math.log10(yHi) : 0;

  const sx = (x: number) => PAD.l + ((x - xLo) / (xHi - xLo)) * iW;
  const sy = (y: number) => {
    if (logY) {
      const ly = Math.log10(Math.max(y, 1e-12));
      return PAD.t + iH - ((ly - lyLo) / (lyHi - lyLo)) * iH;
    }
    return PAD.t + iH - ((y - yLo) / (yHi - yLo)) * iH;
  };
  const polyline = (xs: number[], ys: number[]) =>
    xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${sx(x).toFixed(1)},${sy(ys[i]).toFixed(1)}`).join(' ');

  let domeFillPath = '';
  if (satXLiq?.length && satXVap?.length && satY?.length) {
    const fwd = satXLiq.map((x, i) => `${i === 0 ? 'M' : 'L'}${sx(x).toFixed(1)},${sy(satY[i]).toFixed(1)}`).join(' ');
    const rev = [...satXVap].reverse().map((x, i) => {
      const yi = satY.length - 1 - i;
      return `L${sx(x).toFixed(1)},${sy(satY[yi]).toFixed(1)}`;
    }).join(' ');
    domeFillPath = fwd + ' ' + rev + ' Z';
  }

  const N = 4;
  const xTicks = Array.from({ length: N + 1 }, (_, i) => xLo + (xHi - xLo) * i / N);
  let yTicks: number[];
  if (logY) {
    const e0 = Math.ceil(lyLo), e1 = Math.floor(lyHi);
    yTicks = Array.from({ length: e1 - e0 + 1 }, (_, i) => 10 ** (e0 + i)).filter(v => v >= yLo && v <= yHi * 1.1);
    if (yTicks.length === 0) yTicks = [yMin, yMax];
  } else {
    yTicks = Array.from({ length: N + 1 }, (_, i) => yLo + (yHi - yLo) * i / N);
  }
  const fmtTick = (v: number): string => {
    const a = Math.abs(v);
    if (a >= 1e9) return `${(v/1e9).toFixed(1)}G`;
    if (a >= 1e6) return `${(v/1e6).toFixed(1)}M`;
    if (a >= 1e3) return `${(v/1e3).toFixed(0)}k`;
    if (a < 0.01 && a > 0) return v.toExponential(1);
    return v.toFixed(a < 10 ? 2 : 0);
  };

  const getTooltip = (i: number) => {
    const lbl = labels?.[i];
    return statePoints.find((p: any) => p.label === lbl) ?? null;
  };

  return (
    <div style={{ width: '100%', lineHeight: 0, position: 'relative' }}>
      {(zoom !== 1 || pan.x !== 0 || pan.y !== 0) && (
        <button onClick={resetView} style={{
          position: 'absolute', top: 6, right: 6, zIndex: 10,
          fontSize: 9, padding: '2px 7px', borderRadius: 0,
          background: 'var(--tb-bg-elevated)', border: '1px solid var(--tb-border)',
          color: 'var(--tb-text-secondary)', cursor: 'pointer',
        }}>
          Reset
        </button>
      )}
      <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" height="auto"
        onWheel={onWheel} onMouseDown={onMouseDown} onMouseMove={onMouseMove}
        onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
        style={{ display: 'block', fontFamily: "'JetBrains Mono','Fira Code',monospace",
                  cursor: isPanning ? 'grabbing' : 'grab' }}>

        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}
           style={{ transformOrigin: `${PAD.l + iW/2}px ${PAD.t + iH/2}px` }}>

          <rect x={PAD.l} y={PAD.t} width={iW} height={iH} fill="rgba(15,23,42,0.6)" rx="2" />

          {yTicks.map((v, i) => (
            <line key={`gy${i}`} x1={PAD.l} y1={sy(v)} x2={VW-PAD.r} y2={sy(v)}
              stroke="rgba(51,65,85,0.7)" strokeWidth="0.6" strokeDasharray="3,4" />
          ))}
          {xTicks.map((v, i) => (
            <line key={`gx${i}`} x1={sx(v)} y1={PAD.t} x2={sx(v)} y2={VH-PAD.b}
              stroke="rgba(51,65,85,0.7)" strokeWidth="0.6" strokeDasharray="3,4" />
          ))}

          {domeFillPath && <path d={domeFillPath} fill="rgba(14,165,233,0.10)" />}
          {satXLiq?.length && satY?.length && (
            <path d={polyline(satXLiq, satY)} fill="none" stroke="#38bdf8" strokeWidth="1.6" strokeOpacity="0.8" />
          )}
          {satXVap?.length && satY?.length && (
            <path d={polyline(satXVap, satY)} fill="none" stroke="#f97316" strokeWidth="1.6" strokeOpacity="0.8" />
          )}

          <path d={polyline(cycleX, cycleY) + ' Z'} fill="none"
            stroke="var(--tb-accent, #0ea5e9)" strokeWidth="2.2"
            strokeLinejoin="round" strokeLinecap="round" />

          {cycleX.slice(0, -1).map((x, i) => {
            const cx = sx(x), cy = sy(cycleY![i]);
            const lbl = labels?.[i] ?? String(i+1);
            const isHov = hovered === i;
            const offX = cx > VW * 0.8 ? -12 : 8;
            const offY = cy < PAD.t + 20 ? 14 : -7;
            return (
              <g key={i} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}
                style={{ cursor: 'crosshair' }}>
                <circle cx={cx} cy={cy} r={12} fill="transparent" />
                <circle cx={cx} cy={cy} r={isHov ? 7 : 5}
                  fill={isHov ? 'var(--tb-accent,#0ea5e9)' : 'var(--tb-bg-surface,#1e293b)'}
                  stroke="var(--tb-accent,#0ea5e9)" strokeWidth="2" style={{ transition: 'r 100ms' }} />
                <text x={cx+offX} y={cy+offY} fontSize="9.5" fontWeight="700"
                  fill={isHov ? '#fff' : '#e2e8f0'} textAnchor="middle">
                  {lbl}
                </text>
              </g>
            );
          })}

          {yTicks.map((v, i) => (
            <text key={`ly${i}`} x={PAD.l-5} y={sy(v)+3.5} textAnchor="end" fontSize="8"
              fill="rgba(148,163,184,0.85)">
              {fmtTick(v)}
            </text>
          ))}
          {xTicks.map((v, i) => (
            <text key={`lx${i}`} x={sx(v)} y={VH-PAD.b+14} textAnchor="middle" fontSize="8"
              fill="rgba(148,163,184,0.85)">
              {fmtTick(v)}
            </text>
          ))}

          <text x={VW/2} y={VH-5} textAnchor="middle" fontSize="9" fill="rgba(148,163,184,0.7)">
            {xLabel}
          </text>
          <text x={12} y={PAD.t+iH/2} textAnchor="middle" fontSize="9" fill="rgba(148,163,184,0.7)"
            transform={`rotate(-90,12,${PAD.t+iH/2})`}>
            {yLabel}
          </text>
          <rect x={PAD.l} y={PAD.t} width={iW} height={iH} fill="none"
            stroke="rgba(51,65,85,0.9)" strokeWidth="0.8" />
        </g>

        {/* Tooltip — outside zoom group */}
        {hovered !== null && (() => {
          const i = hovered;
          const cx = sx(cycleX[i]) * zoom + pan.x;
          const cy = sy(cycleY![i]) * zoom + pan.y;
          const sp = getTooltip(i);
          if (!sp) return null;
          const TW = 152, TH = 112;
          const tx = Math.min(cx + 14, VW - TW - 4);
          const ty = Math.max(Math.min(cy - 20, VH - TH - 4), PAD.t);
          return (
            <g style={{ pointerEvents: 'none' }}>
              <rect x={tx} y={ty} width={TW} height={TH} rx="5" ry="5"
                fill="rgba(15,23,42,0.94)" stroke="var(--tb-accent,#0ea5e9)" strokeWidth="1" />
              <text x={tx+8} y={ty+15} fontSize="10" fontWeight="700" fill="var(--tb-accent,#0ea5e9)">
                State {sp.label}
              </text>
              <text x={tx+TW-6} y={ty+15} fontSize="8" fontWeight="600" textAnchor="end"
                fill={sp.phase?.includes('two') ? '#fbbf24' : sp.phase?.includes('sup') ? '#f87171' : '#60a5fa'}>
                {sp.phase ?? ''}
              </text>
              <line x1={tx+6} y1={ty+19} x2={tx+TW-6} y2={ty+19} stroke="rgba(51,65,85,0.8)" strokeWidth="0.6" />
              {([
                ['T',  `${fmt(sp.T_K)} K  (${fmt(sp.T_C)} °C)`],
                ['P',  `${fmt(sp.P_kPa, 1)} kPa`],
                ['h',  `${fmt(sp.h_kJ_kg)} kJ/kg`],
                ['s',  `${fmt(sp.s_kJ_kgK, 4)} kJ/kg·K`],
                ['x',  sp.x != null ? sp.x.toFixed(3) : '—'],
              ] as [string,string][]).map(([k, v], ri) => (
                <g key={k}>
                  <text x={tx+8}  y={ty+32+ri*17} fontSize="8.5" fill="rgba(148,163,184,0.75)">{k}</text>
                  <text x={tx+24} y={ty+32+ri*17} fontSize="8.5" fontWeight="600" fill="#e2e8f0">{v}</text>
                </g>
              ))}
            </g>
          );
        })()}
      </svg>
    </div>
  );
}
