import { useState, useRef, useEffect } from 'react';
import { calculateProperties, getFluids } from '../../lib/api';
import DiagramPanel from './DiagramPanel';
import { Calculator, FlaskConical, Download, RefreshCw, AlertCircle, Search, ChevronDown } from 'lucide-react';
import { usePropertyCalcStore, type UnitSys } from '../../store/propertyCalculatorStore';
import { useUnitSystemStore } from '../../store/unitSystemStore';

// ─────────────────────────────────────────────────────────────────────────────
// Static data
// ─────────────────────────────────────────────────────────────────────────────

interface Pair { p1: string; p2: string; label: string; ph1: string; ph2: string; }

const DEFAULT_FLUIDS = [
  'Water', 'R134a', 'R410A', 'R32', 'R22', 'Ammonia', 'CO2',
  'Air', 'Nitrogen', 'Helium', 'n-Butane', 'IsoButane', 'Propane', 'Ethane',
];

// Placeholders in display units: P→kPa, H/U→kJ/kg, S→kJ/(kg·K)
export const PAIRS: Pair[] = [
  { p1: 'P', p2: 'T', label: 'Pressure + Temperature', ph1: '10', ph2: '373.15' },
  { p1: 'P', p2: 'H', label: 'Pressure + Enthalpy', ph1: '10', ph2: '2676' },
  { p1: 'P', p2: 'S', label: 'Pressure + Entropy', ph1: '10', ph2: '7.355' },
  { p1: 'P', p2: 'Q', label: 'Pressure + Vapour Quality', ph1: '10', ph2: '0.5' },
  { p1: 'P', p2: 'D', label: 'Pressure + Density', ph1: '10', ph2: '0.6' },
  { p1: 'T', p2: 'Q', label: 'Temperature + Vapour Quality', ph1: '373.15', ph2: '0.0' },
  { p1: 'T', p2: 'S', label: 'Temperature + Entropy', ph1: '373.15', ph2: '7.355' },
  { p1: 'T', p2: 'H', label: 'Temperature + Enthalpy', ph1: '373.15', ph2: '2676' },
  { p1: 'H', p2: 'S', label: 'Enthalpy + Entropy', ph1: '2676', ph2: '7.355' },
  { p1: 'P', p2: 'U', label: 'Pressure + Internal Energy', ph1: '10', ph2: '2506' },
];

const UNIT_LABELS_FULL: Record<string, Record<UnitSys, string>> = {
  T: { SI: 'K', Imperial: '°F' },
  P: { SI: 'kPa', Imperial: 'psi' },
  H: { SI: 'kJ/kg', Imperial: 'Btu/lb' },
  S: { SI: 'kJ/(kg·K)', Imperial: 'Btu/lb·R' },
  U: { SI: 'kJ/kg', Imperial: 'Btu/lb' },
  D: { SI: 'kg/m³', Imperial: 'lb/ft³' },
  V: { SI: 'm³/kg', Imperial: 'ft³/lb' },
  Cp: { SI: 'kJ/(kg·K)', Imperial: 'Btu/lb·R' },
  Cv: { SI: 'kJ/(kg·K)', Imperial: 'Btu/lb·R' },
  viscosity: { SI: 'Pa·s', Imperial: 'lb/ft·hr' },
  conductivity: { SI: 'W/(m·K)', Imperial: 'Btu/hr·ft·R' },
  Pr: { SI: '—', Imperial: '—' },
  Z: { SI: '—', Imperial: '—' },
  M: { SI: 'kg/mol', Imperial: 'lb/mol' },
  A: { SI: 'm/s', Imperial: 'ft/s' },
  quality: { SI: '—', Imperial: '—' },
  phase: { SI: '', Imperial: '' },
  Tcrit: { SI: 'K', Imperial: 'K' },
  Pcrit: { SI: 'kPa', Imperial: 'psi' },
  Ttriple: { SI: 'K', Imperial: 'K' },
  Ptriple: { SI: 'kPa', Imperial: 'psi' },
  T_sat: { SI: 'K', Imperial: '°F' },
  P_sat: { SI: 'kPa', Imperial: 'psi' },
  hf: { SI: 'kJ/kg', Imperial: 'Btu/lb' },
  hg: { SI: 'kJ/kg', Imperial: 'Btu/lb' },
  sf: { SI: 'kJ/(kg·K)', Imperial: 'Btu/lb·R' },
  sg: { SI: 'kJ/(kg·K)', Imperial: 'Btu/lb·R' },
  _hfg: { SI: 'kJ/kg', Imperial: 'Btu/lb' },
};

function unitOf(key: string, sys: UnitSys) { return UNIT_LABELS_FULL[key]?.[sys] ?? ''; }

// doConvert: SI base units (Pa, J/kg, J/(kg·K)) → display units (kPa, kJ/kg, kJ/(kg·K))
// For Imperial it converts from SI base to Imperial display.
function doConvert(key: string, val: number, sys: UnitSys): number {
  if (sys === 'SI') {
    if (['P', 'Pcrit', 'Ptriple', 'P_sat'].includes(key)) return val / 1000;   // Pa → kPa
    if (['H', 'hf', 'hg', 'U', '_hfg'].includes(key)) return val / 1000;   // J/kg → kJ/kg
    if (['S', 'sf', 'sg', 'Cp', 'Cv'].includes(key)) return val / 1000;   // J/(kg·K) → kJ/(kg·K)
    return val; // T, D, V, quality, phase, etc. — unchanged
  }
  // Imperial (from SI base units)
  if (key === 'T' || key === 'T_sat') return val * 9 / 5 - 459.67;
  if (['P', 'Pcrit', 'Ptriple', 'P_sat'].includes(key)) return val / 6894.76;
  if (['H', 'hf', 'hg', 'U', '_hfg'].includes(key)) return val / 2326;
  if (['S', 'sf', 'sg', 'Cp', 'Cv'].includes(key)) return val / 4186.8;
  if (key === 'D') return val / 16.0185;
  if (key === 'V') return val * 16.0185;
  if (key === 'M') return val * 1000 / 453.592;
  if (key === 'viscosity') return val * 0.000672;
  if (key === 'conductivity') return val * 0.5779;
  if (key === 'A') return val * 3.281;
  return val;
}

// toSI: convert user-typed display value back to SI base unit for API call
function toSI(prop: string, displayVal: number, sys: UnitSys): number {
  if (sys === 'SI') {
    if (prop === 'P') return displayVal * 1000;          // kPa → Pa
    if (prop === 'H') return displayVal * 1000;          // kJ/kg → J/kg
    if (prop === 'S') return displayVal * 1000;          // kJ/(kg·K) → J/(kg·K)
    if (prop === 'U') return displayVal * 1000;          // kJ/kg → J/kg
    return displayVal; // T, Q, D, etc. — no conversion needed
  }
  // Imperial → SI base
  if (prop === 'T') return (displayVal + 459.67) * 5 / 9;
  if (prop === 'P') return displayVal * 6894.76;
  if (prop === 'H') return displayVal * 2326;
  if (prop === 'S') return displayVal * 4186.8;
  if (prop === 'U') return displayVal * 2326;
  return displayVal;
}

function fmt(key: string, val: number | null | undefined, sys: UnitSys): string {
  if (val == null || isNaN(val as number)) return '-';
  const v = doConvert(key, val, sys), abs = Math.abs(v);
  if (abs === 0) return '0';
  if (abs < 1e-4 || abs > 1e9) return v.toExponential(4);
  if (abs < 0.01) return v.toFixed(6);
  if (abs < 100) return v.toFixed(4);
  return v.toFixed(2);
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function Row({ label, k, result, sys, idx }: { label: string; k: string; result: any; sys: UnitSys; idx?: number }) {
  const raw = result[k];
  if (raw == null) return null;
  const disp = k === 'phase' ? String(raw).replace(/_/g, ' ') : fmt(k, raw, sys);
  const unit = unitOf(k, sys);
  return (
    <tr className="tb-row"
      style={{
        borderBottom: '1px solid var(--tb-border-soft)',
        transition: 'background 120ms',
        background: (idx ?? 0) % 2 === 0 ? 'var(--tb-bg-surface)' : 'var(--tb-bg-subtle)',
      }}>
      <td style={{
        padding: '7px 12px', fontSize: 12.5, color: 'var(--tb-text-secondary)',
        width: 180, fontWeight: 500
      }}>
        {label}
      </td>
      <td style={{
        padding: '7px 12px', fontSize: 12.5, fontFamily: 'monospace', fontWeight: 700,
        color: 'var(--tb-text-primary)', textAlign: 'right'
      }}>
        {disp}
      </td>
      <td style={{
        padding: '7px 12px', fontSize: 11, color: 'var(--tb-text-muted)',
        textAlign: 'right', whiteSpace: 'nowrap', fontFamily: 'monospace'
      }}>
        {unit}
      </td>
    </tr>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      marginBottom: 10, borderRadius: 0, overflow: 'hidden',
      border: '1px solid var(--tb-border)',
      boxShadow: 'var(--tb-panel-inset), var(--tb-panel-shadow)'
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase',
        padding: '6px 12px', color: 'var(--tb-accent)',
        background: 'var(--tb-bg-elevated)',
        borderBottom: '1px solid var(--tb-border)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.08)',
      }}>
        {title}
      </div>
      <table style={{ width: '100%', background: 'var(--tb-bg-surface)', borderCollapse: 'collapse' }}>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

// ── Searchable fluid dropdown ──────────────────────────────────────────────────
function FluidSelector({ fluids, value, onChange }: {
  fluids: string[]; value: string; onChange: (f: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = query.trim() === ''
    ? fluids
    : fluids.filter(f => f.toLowerCase().startsWith(query.toLowerCase()))
      .concat(fluids.filter(f =>
        !f.toLowerCase().startsWith(query.toLowerCase()) &&
        f.toLowerCase().includes(query.toLowerCase())
      ));

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false); setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  function select(f: string) { onChange(f); setOpen(false); setQuery(''); }
  function handleOpen() { setOpen(true); setQuery(''); setTimeout(() => inputRef.current?.focus(), 50); }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button type="button" onClick={handleOpen}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderRadius: 0, padding: '7px 12px', fontSize: 13,
          background: 'var(--tb-input-bg)', border: '1px solid var(--tb-input-border)',
          color: 'var(--tb-text-primary)', cursor: 'pointer',
          boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.06)',
        }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <FlaskConical style={{ width: 14, height: 14, color: 'var(--tb-accent)', flexShrink: 0 }} />
          {value}
        </span>
        <ChevronDown style={{
          width: 15, height: 15, color: 'var(--tb-text-muted)',
          transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 150ms'
        }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', zIndex: 50, top: 'calc(100% + 4px)', width: '100%',
          borderRadius: 0, boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          background: 'var(--tb-bg-surface)', border: '1px solid var(--tb-border)',
          overflow: 'hidden',
        }}>
          <div style={{ padding: 8, borderBottom: '1px solid var(--tb-border)' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, borderRadius: 0, padding: '5px 10px',
              background: 'var(--tb-input-bg)', border: '1px solid var(--tb-input-border)',
            }}>
              <Search style={{ width: 13, height: 13, color: 'var(--tb-text-muted)', flexShrink: 0 }} />
              <input ref={inputRef} type="text" value={query} onChange={e => setQuery(e.target.value)}
                placeholder="Search fluids…" style={{
                  background: 'transparent', border: 'none', outline: 'none',
                  fontSize: 13, color: 'var(--tb-text-primary)', flex: 1,
                }} />
              {query && (
                <button onClick={() => { setQuery(''); inputRef.current?.focus(); }}
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: 'var(--tb-text-muted)', fontSize: 11
                  }}>✕</button>
              )}
            </div>
            <p style={{ fontSize: 11, marginTop: 5, paddingLeft: 2, color: 'var(--tb-text-muted)' }}>
              {filtered.length} of {fluids.length} fluids
            </p>
          </div>
          <ul style={{ maxHeight: 220, overflowY: 'auto', listStyle: 'none', margin: 0, padding: '4px 0' }}>
            {filtered.length === 0 ? (
              <li style={{ padding: '10px 12px', textAlign: 'center', fontSize: 13, color: 'var(--tb-text-muted)' }}>
                No match
              </li>
            ) : filtered.map(f => {
              const active = f === value;
              return (
                <li key={f}>
                  <button type="button" onClick={() => select(f)} style={{
                    width: '100%', textAlign: 'left', padding: '6px 12px', fontSize: 13,
                    background: active ? 'var(--tb-accent-subtle)' : 'transparent',
                    color: active ? 'var(--tb-accent)' : 'var(--tb-text-secondary)',
                    fontWeight: active ? 600 : 400, border: 'none', cursor: 'pointer',
                  }}
                    onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--tb-bg-elevated)'; }}
                    onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                    {f}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component — state persisted in Zustand store across tab switches
// ─────────────────────────────────────────────────────────────────────────────
export default function PropertyCalculator() {
  const [fluids, setFluids] = useState<string[]>(DEFAULT_FLUIDS);
  const [loading, setLoading] = useState(false);
  const [fluidsError, setFluidsError] = useState<string | null>(null);

  // Persistent state from store
  const fluid = usePropertyCalcStore(s => s.fluid);
  const pairIdx = usePropertyCalcStore(s => s.pairIdx);
  const val1 = usePropertyCalcStore(s => s.val1);
  const val2 = usePropertyCalcStore(s => s.val2);
  const sys = usePropertyCalcStore(s => s.sys);
  const result = usePropertyCalcStore(s => s.result);
  const storeError = usePropertyCalcStore(s => s.error);

  const setFluid = usePropertyCalcStore(s => s.setFluid);
  const setPairIdx = usePropertyCalcStore(s => s.setPairIdx);
  const setVal1 = usePropertyCalcStore(s => s.setVal1);
  const setVal2 = usePropertyCalcStore(s => s.setVal2);
  const setSys = usePropertyCalcStore(s => s.setSys);
  const setResult = usePropertyCalcStore(s => s.setResult);
  const setError = usePropertyCalcStore(s => s.setError);
  const resetStore = usePropertyCalcStore(s => s.reset);

  // Sync with global unit system toggle in top bar
  const globalUnit = useUnitSystemStore(s => s.unitSystem);
  useEffect(() => { setSys(globalUnit as UnitSys); }, [globalUnit]);

  const pair = PAIRS[pairIdx];
  const prop1 = pair.p1;
  const prop2 = pair.p2;

  useEffect(() => {
    getFluids()
      .then(fluidsList => {
        if (fluidsList?.length) {
          setFluids(Array.from(new Set([...DEFAULT_FLUIDS, ...fluidsList.filter(Boolean)])));
          setFluidsError(null);
        }
      })
      .catch(err => {
        console.error('Failed to load fluid list from server:', err);
        setFluidsError('Could not reach the server for the full fluid list — showing a limited offline set.');
      });
  }, []);

  function handlePairChange(idx: number) {
    setPairIdx(idx);
    setVal1(PAIRS[idx].ph1);
    setVal2(PAIRS[idx].ph2);
    setError('');
    setResult(null);
  }

  async function handleCompute() {
    setError(''); setLoading(true); setResult(null);
    try {
      const data = await calculateProperties({
        fluid,
        input1_type: prop1, input1_value: toSI(prop1, parseFloat(val1), sys),
        input2_type: prop2, input2_value: toSI(prop2, parseFloat(val2), sys),
      } as any);
      setResult(data);
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Calculation failed.');
    } finally { setLoading(false); }
  }

  function handleReset() {
    resetStore();
  }

  function handleCSV() {
    if (!result) return;
    const rows = ['Property,Value,Unit'];
    const keys: [string, string][] = [
      ['Temperature', 'T'], ['Pressure', 'P'], ['Enthalpy', 'H'], ['Entropy', 'S'],
      ['Internal Energy', 'U'], ['Density', 'D'], ['Specific Volume', 'V'],
      ['Cp', 'Cp'], ['Cv', 'Cv'], ['Viscosity', 'viscosity'],
      ['Conductivity', 'conductivity'], ['Prandtl No.', 'Pr'],
      ['Compressibility Z', 'Z'], ['Molar Mass', 'M'], ['Speed of Sound', 'A'],
      ['Vapour Quality', 'quality'], ['Phase', 'phase'],
      ['T_crit', 'Tcrit'], ['P_crit', 'Pcrit'], ['T_triple', 'Ttriple'], ['P_triple', 'Ptriple'],
      ['T_sat', 'T_sat'], ['P_sat', 'P_sat'],
      ['h_f', 'hf'], ['h_g', 'hg'], ['h_fg', '_hfg'], ['s_f', 'sf'], ['s_g', 'sg'],
    ];
    const hfgResult = { _hfg: result.hg != null && result.hf != null ? result.hg - result.hf : null };
    keys.forEach(([lbl, k]) => {
      const src = k === '_hfg' ? hfgResult : result;
      const v = k === 'phase' ? String(src[k] || '') : fmt(k, src[k], sys);
      rows.push(`"${lbl}","${v}","${unitOf(k, sys)}"`);
    });
    const url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
    Object.assign(document.createElement('a'), {
      href: url, download: `thermobird_${fluid}_${prop1}${prop2}.csv`
    }).click();
    URL.revokeObjectURL(url);
  }

  const canCompute = val1 !== '' && val2 !== '' &&
    !isNaN(parseFloat(val1)) && !isNaN(parseFloat(val2));

  function phaseStyle(phase: string | undefined) {
    if (!phase) return { color: '#94a3b8', bg: 'rgba(100,116,139,0.12)', border: 'rgba(100,116,139,0.25)' };
    if (phase.includes('two')) return { color: '#c084fc', bg: 'rgba(192,132,252,0.1)', border: 'rgba(192,132,252,0.28)' };
    if (phase.includes('liquid')) return { color: '#60a5fa', bg: 'rgba(96,165,250,0.1)', border: 'rgba(96,165,250,0.28)' };
    if (phase.includes('gas') || phase.includes('vapor')) return { color: '#fb923c', bg: 'rgba(251,146,60,0.1)', border: 'rgba(251,146,60,0.28)' };
    if (phase.includes('supercritical')) return { color: '#34d399', bg: 'rgba(52,211,153,0.1)', border: 'rgba(52,211,153,0.28)' };
    return { color: '#94a3b8', bg: 'rgba(100,116,139,0.12)', border: 'rgba(100,116,139,0.25)' };
  }

  const hfgResult: any = result
    ? { _hfg: result.hg != null && result.hf != null ? result.hg - result.hf : null }
    : {};

  // Shared card style — with edge shading
  const card: React.CSSProperties = {
    background: 'var(--tb-bg-surface)',
    border: '1px solid var(--tb-border)',
    borderRadius: 0,
    padding: '14px 16px',
    boxShadow: 'var(--tb-panel-inset), var(--tb-panel-shadow)',
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 20, background: 'var(--tb-bg-base)' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              padding: 8, borderRadius: 0,
              background: 'var(--tb-accent-subtle)', border: '1px solid var(--tb-accent-border)',
              boxShadow: 'var(--tb-panel-inset)',
            }}>
              <Calculator style={{ width: 20, height: 20, color: 'var(--tb-accent)' }} />
            </div>
            <div>
              <h2 style={{
                fontSize: 18, fontWeight: 700, color: 'var(--tb-text-primary)',
                fontFamily: 'Outfit, sans-serif', margin: 0, letterSpacing: '-0.02em'
              }}>
                Property Estimator
              </h2>
              <p style={{ fontSize: 11.5, color: 'var(--tb-text-muted)', marginTop: 2 }}>
                Thermodynamic state lookup via CoolProp
              </p>
            </div>
          </div>

          {/* SI / Imperial toggle */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 3, padding: 4,
            borderRadius: 0, background: 'var(--tb-bg-surface)',
            border: '1px solid var(--tb-border)', boxShadow: 'var(--tb-panel-inset)',
          }}>
            {(['SI', 'Imperial'] as UnitSys[]).map(s => (
              <button key={s} onClick={() => setSys(s)} style={{
                padding: '4px 14px', borderRadius: 0, fontSize: 12.5, fontWeight: 500,
                border: 'none', cursor: 'pointer', transition: 'all 150ms',
                background: sys === s ? 'var(--tb-accent)' : 'transparent',
                color: sys === s ? '#fff' : 'var(--tb-text-secondary)',
              }}>
                {s}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 20 }}>

          {/* ── LEFT: inputs ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Fluid selector */}
            <div style={card}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <FlaskConical style={{ width: 15, height: 15, color: 'var(--tb-accent)' }} />
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--tb-text-secondary)' }}>
                  Working Fluid
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--tb-text-muted)' }}>
                  {fluids.length} available
                </span>
              </div>
              {fluidsError && (
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', marginBottom: 10,
                  borderRadius: 0, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.28)',
                }}>
                  <AlertCircle style={{ width: 14, height: 14, flexShrink: 0, marginTop: 1, color: '#f87171' }} />
                  <p style={{ fontSize: 11.5, color: '#f87171', margin: 0 }}>{fluidsError}</p>
                </div>
              )}
              <FluidSelector fluids={fluids} value={fluid}
                onChange={f => { setFluid(f); setResult(null); setError(''); }} />
            </div>

            {/* Input pair */}
            <div style={card}>
              <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--tb-text-secondary)', marginBottom: 10 }}>
                Input Pair
              </p>
              <div style={{ position: 'relative' }}>
                <select value={pairIdx} onChange={e => handlePairChange(parseInt(e.target.value, 10))}
                  style={{
                    width: '100%', appearance: 'none', borderRadius: 0,
                    paddingLeft: 12, paddingRight: 32, paddingTop: 8, paddingBottom: 8,
                    fontSize: 12.5, background: 'var(--tb-input-bg)',
                    border: '1px solid var(--tb-input-border)', color: 'var(--tb-text-primary)',
                    cursor: 'pointer', outline: 'none',
                    boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.06)',
                  }}>
                  {PAIRS.map((p, idx) => (
                    <option key={idx} value={idx}>{p.p1} + {p.p2}  —  {p.label}</option>
                  ))}
                </select>
                <ChevronDown style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  width: 14, height: 14, pointerEvents: 'none', color: 'var(--tb-text-muted)',
                }} />
              </div>
              <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                {[prop1, prop2].map((p, i) => (
                  <span key={i} style={{
                    flex: 1, textAlign: 'center', fontSize: 11, borderRadius: 0, padding: '4px 0',
                    fontFamily: 'monospace', background: 'var(--tb-bg-elevated)', color: 'var(--tb-text-secondary)',
                    border: '1px solid var(--tb-border-soft)',
                  }}>
                    {p} [{unitOf(p, sys)}]
                  </span>
                ))}
              </div>
            </div>

            {/* Known values */}
            <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--tb-text-secondary)' }}>
                Known Values
              </p>

              {[{ prop: prop1, val: val1, set: setVal1, side: 0 },
              { prop: prop2, val: val2, set: setVal2, side: 1 }].map(({ prop, val, set, side }) => (
                <div key={prop + side}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span style={{ fontSize: 12, color: 'var(--tb-text-secondary)' }}>
                      <span style={{ fontFamily: 'monospace', color: 'var(--tb-accent)', marginRight: 4 }}>{prop}</span>
                      {pair.label.split(' + ')[side]}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--tb-text-muted)' }}>[{unitOf(prop, sys)}]</span>
                  </div>
                  <input type="number" value={val} onChange={e => set(e.target.value)}
                    style={{
                      width: '100%', borderRadius: 0, padding: '7px 12px', fontSize: 13,
                      fontFamily: 'monospace', background: 'var(--tb-input-bg)',
                      border: '1px solid var(--tb-input-border)', color: 'var(--tb-text-primary)',
                      outline: 'none', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.06)',
                    }} />
                </div>
              ))}

              {storeError && (
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px',
                  borderRadius: 0, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.28)',
                }}>
                  <AlertCircle style={{ width: 15, height: 15, flexShrink: 0, marginTop: 1, color: '#f87171' }} />
                  <p style={{ fontSize: 12.5, color: '#f87171', margin: 0 }}>{storeError}</p>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleCompute} disabled={!canCompute || loading} style={{
                  flex: 1, fontWeight: 600, padding: '9px 0', borderRadius: 0, fontSize: 13,
                  border: 'none', cursor: (!canCompute || loading) ? 'not-allowed' : 'pointer',
                  background: (!canCompute || loading) ? 'var(--tb-bg-elevated)' : 'var(--tb-accent)',
                  color: (!canCompute || loading) ? 'var(--tb-text-muted)' : '#fff',
                  transition: 'all 150ms',
                }}>
                  {loading ? (
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                      <svg style={{ animation: 'tb-spin 1s linear infinite', width: 14, height: 14 }} viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" style={{ opacity: 0.25 }} />
                        <path fill="currentColor" d="M4 12a8 8 0 018-8v8z" style={{ opacity: 0.75 }} />
                      </svg>
                      Computing…
                    </span>
                  ) : 'Compute State'}
                </button>
                <button onClick={handleReset} title="Reset all" style={{
                  padding: '9px 12px', borderRadius: 0, border: '1px solid var(--tb-border)',
                  background: 'var(--tb-bg-elevated)', color: 'var(--tb-text-secondary)',
                  cursor: 'pointer', transition: 'all 150ms',
                }}>
                  <RefreshCw style={{ width: 14, height: 14 }} />
                </button>
              </div>
            </div>

            {/* Symbol reference */}
            <div style={{
              borderRadius: 0, padding: '12px 14px',
              background: 'var(--tb-bg-surface)', border: '1px solid var(--tb-border-soft)',
              boxShadow: 'var(--tb-panel-inset)',
            }}>
              <p style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase',
                color: 'var(--tb-text-muted)', marginBottom: 8
              }}>Input symbols</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 8px' }}>
                {[['T', 'Temperature (K)'], ['P', 'Pressure (kPa)'], ['H', 'Enthalpy (kJ/kg)'],
                ['S', 'Entropy (kJ/kg·K)'], ['Q', 'Quality (0–1)'], ['D', 'Density (kg/m³)'],
                ['U', 'Int. Energy (kJ/kg)']].map(([sym, desc]) => (
                  <div key={sym} style={{ display: 'flex', gap: 6, fontSize: 11.5, color: 'var(--tb-text-muted)' }}>
                    <span style={{ fontFamily: 'monospace', color: 'var(--tb-accent)', minWidth: 14 }}>{sym}</span>
                    <span>{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── RIGHT: results ── */}
          <div>
            {result ? (
              <div>
                {/* Toolbar */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      fontSize: 15, fontWeight: 700, color: 'var(--tb-text-primary)',
                      fontFamily: 'Outfit, sans-serif'
                    }}>
                      {fluid}
                    </span>
                    {(() => {
                      const ps = phaseStyle(result.phase);
                      return (
                        <span style={{
                          fontSize: 11, padding: '2px 9px', borderRadius: 0,
                          border: `1px solid ${ps.border}`, color: ps.color,
                          background: ps.bg, fontWeight: 600, textTransform: 'capitalize',
                        }}>
                          {result.phase ? result.phase.replace(/_/g, ' ') : 'unknown'}
                        </span>
                      );
                    })()}
                  </div>
                  <button onClick={handleCSV} style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
                    borderRadius: 0, fontSize: 12.5, cursor: 'pointer',
                    background: 'var(--tb-bg-surface)', border: '1px solid var(--tb-border)',
                    color: 'var(--tb-text-secondary)', boxShadow: 'var(--tb-panel-inset)',
                    transition: 'all 150ms',
                  }}>
                    <Download style={{ width: 13, height: 13 }} /> CSV
                  </button>
                </div>

                <Section title="Primary State">
                  <Row label="Temperature" k="T" result={result} sys={sys} idx={0} />
                  <Row label="Pressure" k="P" result={result} sys={sys} idx={1} />
                  <Row label="Enthalpy" k="H" result={result} sys={sys} idx={2} />
                  <Row label="Entropy" k="S" result={result} sys={sys} idx={3} />
                  <Row label="Internal Energy" k="U" result={result} sys={sys} idx={4} />
                  <Row label="Density" k="D" result={result} sys={sys} idx={5} />
                  <Row label="Specific Volume" k="V" result={result} sys={sys} idx={6} />
                  <Row label="Vapour Quality" k="quality" result={result} sys={sys} idx={7} />
                </Section>

                <Section title="Caloric">
                  <Row label="Cp" k="Cp" result={result} sys={sys} idx={0} />
                  <Row label="Cv" k="Cv" result={result} sys={sys} idx={1} />
                </Section>

                <Section title="Transport">
                  <Row label="Dynamic Viscosity" k="viscosity" result={result} sys={sys} idx={0} />
                  <Row label="Thermal Conductivity" k="conductivity" result={result} sys={sys} idx={1} />
                  <Row label="Prandtl Number" k="Pr" result={result} sys={sys} idx={2} />
                </Section>

                <Section title="Other">
                  <Row label="Compressibility Z" k="Z" result={result} sys={sys} idx={0} />
                  <Row label="Molar Mass" k="M" result={result} sys={sys} idx={1} />
                  <Row label="Speed of Sound" k="A" result={result} sys={sys} idx={2} />
                </Section>

                <Section title="Critical and Triple Points">
                  <Row label="T critical" k="Tcrit" result={result} sys={sys} idx={0} />
                  <Row label="P critical" k="Pcrit" result={result} sys={sys} idx={1} />
                  <Row label="T triple" k="Ttriple" result={result} sys={sys} idx={2} />
                  <Row label="P triple" k="Ptriple" result={result} sys={sys} idx={3} />
                </Section>

                {result.T_sat != null && (
                  <Section title="Saturation at State">
                    <Row label="T sat" k="T_sat" result={result} sys={sys} idx={0} />
                    <Row label="P sat" k="P_sat" result={result} sys={sys} idx={1} />
                    <Row label="h_f" k="hf" result={result} sys={sys} idx={2} />
                    <Row label="h_g" k="hg" result={result} sys={sys} idx={3} />
                    <Row label="h_fg" k="_hfg" result={hfgResult} sys={sys} idx={4} />
                    <Row label="s_f" k="sf" result={result} sys={sys} idx={5} />
                    <Row label="s_g" k="sg" result={result} sys={sys} idx={6} />
                  </Section>
                )}

                <DiagramPanel fluid={fluid} T={result.T} P={result.P} H={result.H} S={result.S} />
              </div>
            ) : (
              <div style={{
                minHeight: 360, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', borderRadius: 0,
                border: '1px dashed var(--tb-border)', background: 'var(--tb-bg-surface)',
                boxShadow: 'var(--tb-panel-inset)',
              }}>
                <Calculator style={{ width: 44, height: 44, marginBottom: 12, color: 'var(--tb-text-muted)', opacity: 0.4 }} />
                <p style={{
                  fontSize: 14, fontWeight: 600, color: 'var(--tb-text-secondary)',
                  fontFamily: 'Outfit, sans-serif'
                }}>
                  No results yet
                </p>
                <p style={{ fontSize: 12.5, color: 'var(--tb-text-muted)', marginTop: 4 }}>
                  Select a fluid and pair, then hit Compute
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
