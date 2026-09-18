/**
 * EquationSolver — TBS (ThermoBird Script) editor
 *
 * Features
 * ─────────
 * • Monospace editor with live line numbers
 * • Solve via toolbar button or Ctrl+Enter
 * • Variables panel + step-by-step trace
 * • Syntax help sidebar
 * • Script text propagated to Dashboard via onScriptChange (for global Save)
 * • Optional initialScript prop for loading saved scripts from My Simulations
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, HelpCircle, CheckCircle2, XCircle, AlertTriangle, Terminal, X, Trash2,
  Save, Upload, Download,
} from 'lucide-react';
import { solveEquations, saveSolverScript, type SolveResponse } from '../../lib/api';
import { fmtWithUnitSolver, inferDisplayUnitSolver } from '../../lib/units';

// ── Welcome / starter script ──────────────────────────────────────────────────
// Demonstrates a complete solar-assisted trigeneration system in TBS syntax:
//   Heliostat field → Molten salt receiver → Steam Rankine cycle
//   → ORC bottoming cycle (R245fa) → LiBr-H₂O single-effect absorption chiller
// Units: Pressure [kPa] · Temperature [K] · Enthalpy/Entropy [kJ/kg or kJ/(kg·K)]
// The solver backend auto-converts kPa→Pa and kJ→J before CoolProp calls.
const WELCOME_SCRIPT = `"════════════════════════════════════════════════════════════════"
"  ThermoBird TBS — Solar-Assisted Trigeneration System"
"  Heliostat Field → Molten Salt Receiver → Steam Rankine"
"                  → ORC (R245fa) → LiBr-H₂O Absorption Chiller"
"  Reference: Moran & Shapiro, 7th Ed. | Quanta Labs"
"════════════════════════════════════════════════════════════════"
"  Units: Pressure [kPa] · Temperature [K]"
"         Enthalpy/Entropy [kJ/kg or kJ/(kg·K)]"
"         Mass flow [kg/s] · Power [kW]"
"════════════════════════════════════════════════════════════════"

"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
"  SECTION 1 — HELIOSTAT FIELD & MOLTEN SALT RECEIVER"
"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

"  Solar resource"
DNI        = 0.85         { Direct Normal Irradiance [kW/m²] }
A_field    = 45000        { Heliostat mirror area [m²] }
eta_field  = 0.65         { Optical + cosine + shading efficiency [-] }
eta_CR     = 0.90         { Central receiver thermal efficiency [-] }

"  Thermal power collected by molten salt"
Q_dot_solar  = DNI * A_field * eta_field                     { kW — raw optical power }
Q_dot_salt   = Q_dot_solar * eta_CR                          { kW — delivered to salt loop }

"  Molten salt loop (NaNO3-KNO3 eutectic, simplified as cp_salt)"
cp_salt    = 1.52         { Specific heat of molten salt [kJ/(kg·K)] }
T_salt_hot = 838.15       { Salt outlet from receiver: 565 °C = 838.15 K }
T_salt_cold= 563.15       { Salt return to receiver:   290 °C = 563.15 K }
m_dot_salt = Q_dot_salt / (cp_salt * (T_salt_hot - T_salt_cold))   { kg/s }

"  Receiver exergy"
T0         = 298.15       { Dead-state temperature [K] }
P0         = 101.325      { Dead-state pressure [kPa] }
T_sun      = 5778         { Equivalent sun surface temperature [K] }
X_dot_solar = Q_dot_solar * (1 - T0 / T_sun)                { kW — solar exergy input }


"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
"  SECTION 2 — STEAM RANKINE CYCLE (High-Temperature)"
"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

WorkingFluid$ = 'Water'

"  Rankine operating pressures"
P_ST_boil  = 8000         { Steam generator pressure: 8 MPa [kPa] }
P_ST_cond  = 10           { Condenser pressure: 10 kPa }

"  Isentropic efficiencies"
eta_ST_turb = 0.87        { Steam turbine [-] }
eta_ST_pump = 0.82        { Feedwater pump [-] }

"  Fraction of solar heat allocated to Rankine boiler"
f_Rankine  = 0.70         { 70 % of Q_dot_salt to steam cycle }
Q_dot_HRSG = f_Rankine * Q_dot_salt                          { kW }

"  State ST-1: Condenser exit — saturated liquid"
P_ST1 = P_ST_cond
x_ST1 = 0
h_ST1 = enthalpy(WorkingFluid$, P=P_ST1, x=x_ST1)
s_ST1 = entropy(WorkingFluid$, P=P_ST1, x=x_ST1)
v_ST1 = volume(WorkingFluid$, P=P_ST1, x=x_ST1)

"  State ST-2: Pump exit"
P_ST2   = P_ST_boil
h_ST2s  = h_ST1 + v_ST1 * (P_ST2 - P_ST1)
h_ST2   = h_ST1 + (h_ST2s - h_ST1) / eta_ST_pump

"  State ST-3: Steam generator exit — superheated"
P_ST3 = P_ST_boil
T_ST3 = 793.15            { 520 °C = 793.15 K }
h_ST3 = enthalpy(WorkingFluid$, P=P_ST3, T=T_ST3)
s_ST3 = entropy(WorkingFluid$, P=P_ST3, T=T_ST3)

"  State ST-4: Turbine exit"
P_ST4   = P_ST_cond
h_ST4s  = enthalpy(WorkingFluid$, P=P_ST4, s=s_ST3)
h_ST4   = h_ST3 - eta_ST_turb * (h_ST3 - h_ST4s)
s_ST4   = entropy(WorkingFluid$, P=P_ST4, h=h_ST4)

"  Rankine mass flow (energy balance on HRSG)"
m_dot_ST   = Q_dot_HRSG / (h_ST3 - h_ST2)                   { kg/s }

"  Rankine cycle performance"
W_dot_ST_turb = m_dot_ST * (h_ST3 - h_ST4)                  { kW }
W_dot_ST_pump = m_dot_ST * (h_ST2 - h_ST1)                  { kW }
W_dot_ST_net  = W_dot_ST_turb - W_dot_ST_pump                { kW }
Q_dot_ST_cond = m_dot_ST * (h_ST4 - h_ST1)                  { kW — heat rejected }
eta_ST_cycle  = W_dot_ST_net / Q_dot_HRSG                    { First-law efficiency }

"  Rankine entropy generation"
T_HRSG_source = T_salt_hot
S_dot_gen_HRSG    = m_dot_ST * (s_ST3 - h_ST2/T_HRSG_source) - Q_dot_HRSG / T_HRSG_source
S_dot_gen_ST_turb = m_dot_ST * (s_ST4 - s_ST3)
S_dot_gen_ST_cond = m_dot_ST * (s_ST1 - s_ST4) + Q_dot_ST_cond / T0
S_dot_gen_ST_pump = m_dot_ST * (entropy(WorkingFluid$, P=P_ST2, h=h_ST2) - s_ST1)

"  Rankine exergy destruction"
X_dot_dest_HRSG    = T0 * S_dot_gen_HRSG
X_dot_dest_ST_turb = T0 * S_dot_gen_ST_turb
X_dot_dest_ST_cond = T0 * S_dot_gen_ST_cond
X_dot_dest_ST_pump = T0 * S_dot_gen_ST_pump


"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
"  SECTION 3 — ORC BOTTOMING CYCLE (R245fa)"
"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

ORC_Fluid$ = 'R245fa'

"  ORC pressures"
P_ORC_evap = 1400         { ORC evaporator: 1.4 MPa [kPa] }
P_ORC_cond = 150          { ORC condenser:  150 kPa }

"  ORC efficiencies"
eta_ORC_turb = 0.82
eta_ORC_pump = 0.78

"  Heat source for ORC: waste heat from Rankine condenser"
Q_dot_ORC_avail = 0.40 * Q_dot_ST_cond   { Use 40 % of Rankine condenser heat }

"  State ORC-1: Condenser exit — saturated liquid"
P_ORC1 = P_ORC_cond
x_ORC1 = 0
h_ORC1 = enthalpy(ORC_Fluid$, P=P_ORC1, x=x_ORC1)
s_ORC1 = entropy(ORC_Fluid$, P=P_ORC1, x=x_ORC1)
v_ORC1 = volume(ORC_Fluid$, P=P_ORC1, x=x_ORC1)

"  State ORC-2: Pump exit"
P_ORC2   = P_ORC_evap
h_ORC2s  = h_ORC1 + v_ORC1 * (P_ORC2 - P_ORC1)
h_ORC2   = h_ORC1 + (h_ORC2s - h_ORC1) / eta_ORC_pump

"  State ORC-3: Evaporator exit — saturated or slightly superheated vapour"
P_ORC3 = P_ORC_evap
T_ORC3 = temperature(ORC_Fluid$, P=P_ORC3, x=1) + 5   { 5 K superheat }
h_ORC3 = enthalpy(ORC_Fluid$, P=P_ORC3, T=T_ORC3)
s_ORC3 = entropy(ORC_Fluid$, P=P_ORC3, T=T_ORC3)

"  State ORC-4: Turbine exit"
P_ORC4   = P_ORC_cond
h_ORC4s  = enthalpy(ORC_Fluid$, P=P_ORC4, s=s_ORC3)
h_ORC4   = h_ORC3 - eta_ORC_turb * (h_ORC3 - h_ORC4s)
s_ORC4   = entropy(ORC_Fluid$, P=P_ORC4, h=h_ORC4)

"  ORC mass flow"
m_dot_ORC  = Q_dot_ORC_avail / (h_ORC3 - h_ORC2)            { kg/s }

"  ORC cycle performance"
W_dot_ORC_turb = m_dot_ORC * (h_ORC3 - h_ORC4)              { kW }
W_dot_ORC_pump = m_dot_ORC * (h_ORC2 - h_ORC1)              { kW }
W_dot_ORC_net  = W_dot_ORC_turb - W_dot_ORC_pump             { kW }
Q_dot_ORC_cond = m_dot_ORC * (h_ORC4 - h_ORC1)              { kW }
eta_ORC_cycle  = W_dot_ORC_net / Q_dot_ORC_avail

"  ORC entropy generation"
S_dot_gen_ORC_turb = m_dot_ORC * (s_ORC4 - s_ORC3)
S_dot_gen_ORC_cond = m_dot_ORC * (s_ORC1 - s_ORC4) + Q_dot_ORC_cond / T0
S_dot_gen_ORC_pump = m_dot_ORC * (entropy(ORC_Fluid$, P=P_ORC2, h=h_ORC2) - s_ORC1)
X_dot_dest_ORC_turb = T0 * S_dot_gen_ORC_turb
X_dot_dest_ORC_cond = T0 * S_dot_gen_ORC_cond


"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
"  SECTION 4 — LiBr-H₂O SINGLE-EFFECT ABSORPTION CHILLER"
"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

"  Chiller operating temperatures"
T_gen   = 358.15          { Generator:  85 °C = 358.15 K }
T_cond  = 308.15          { Condenser:  35 °C = 308.15 K }
T_evap  = 278.15          { Evaporator:  5 °C = 278.15 K }
T_abs   = 308.15          { Absorber:   35 °C = 308.15 K }

"  Chiller solution concentrations (LiBr mass fraction)"
X_weak  = 0.595           { Weak solution — leaves absorber  [-] }
X_strong= 0.645           { Strong solution — leaves generator [-] }

"  COP and heat input"
COP_abs = 0.72            { Typical single-effect LiBr COP [-] }

"  Heat driving the chiller: remaining ORC condenser waste + direct salt"
f_abs       = 0.30        { Fraction of remaining salt heat to absorption chiller }
Q_dot_gen   = f_abs * (1 - f_Rankine) * Q_dot_salt           { kW — generator heat }

"  Absorption chiller outputs"
Q_dot_evap  = COP_abs * Q_dot_gen                            { kW — cooling output }
Q_dot_abs   = Q_dot_gen * (1 + COP_abs) - Q_dot_gen         { kW — absorber rejection }
Q_dot_cond_abs = Q_dot_gen + Q_dot_evap - Q_dot_abs         { kW — condenser rejection }

"  LiBr solution enthalpies (via built-in correlations)"
h_weak_abs  = h_librh2o(T_abs, X_weak)                       { kJ/kg }
h_strong_gen= h_librh2o(T_gen, X_strong)                     { kJ/kg }
h_weak_gen  = h_librh2o(T_gen, X_weak)                       { kJ/kg — after SHE }

"  Solution mass flow rates"
m_dot_refrig    = Q_dot_evap / 2454                           { kg/s — approximate latent heat at T_evap }
f_circulation   = X_strong / (X_strong - X_weak)             { Circulation ratio [-] }
m_dot_weak_sol  = f_circulation * m_dot_refrig                { kg/s }
m_dot_strong_sol= m_dot_weak_sol - m_dot_refrig               { kg/s }

"  Entropy generation in absorption chiller"
S_dot_gen_gen  = Q_dot_gen * (1/T_gen - 1/T_salt_hot)        { kW/K — generator }
S_dot_gen_evap = Q_dot_evap * (1/T_evap - 1/T0)              { kW/K — evaporator (negative = useful) }
S_dot_gen_abs  = m_dot_refrig * 8.2 / T_abs                  { kW/K — approx absorber irreversibility }
X_dot_dest_chiller = T0 * (S_dot_gen_gen + S_dot_gen_abs)    { kW }


"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
"  SECTION 5 — TRIGENERATION SYSTEM KPIs"
"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

"  Total useful outputs"
W_dot_total   = W_dot_ST_net + W_dot_ORC_net                  { kW — total electricity }
Q_dot_cooling = Q_dot_evap                                    { kW — cooling capacity }

"  First-law (energy) efficiency — trigeneration"
eta_trigen_I  = (W_dot_total + Q_dot_cooling + Q_dot_gen) / Q_dot_salt

"  Exergy efficiency"
X_dot_work    = W_dot_total                                   { kW — work is pure exergy }
X_dot_cool    = Q_dot_cooling * (T0/T_evap - 1)              { kW — cooling exergy (reverse Carnot) }
X_dot_heat_out= Q_dot_gen * (1 - T0/T_gen)                   { kW — thermal exergy to chiller }
X_dot_useful  = X_dot_work + X_dot_cool + X_dot_heat_out
eta_trigen_II = X_dot_useful / X_dot_solar

"  Total irreversibility"
X_dot_dest_total = X_dot_solar - X_dot_useful

"  Back-work ratios"
BWR_Rankine = W_dot_ST_pump / W_dot_ST_turb
BWR_ORC     = W_dot_ORC_pump / W_dot_ORC_turb

"  Specific work outputs [kJ/kg of working fluid]"
w_net_ST  = W_dot_ST_net / m_dot_ST
w_net_ORC = W_dot_ORC_net / m_dot_ORC
`;

// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  onResults?: (r: SolveResponse) => void;
  onScriptChange?: (script: string) => void;
  initialScript?: string;
  analysisMode?: 'steady' | 'transient';
  onAnalysisModeChange?: (m: 'steady' | 'transient') => void;
  onSaveRequest?: () => void;   // called when Save btn clicked — parent opens its modal
}

export default function EquationSolver({ onResults, onScriptChange, initialScript, analysisMode = 'steady', onAnalysisModeChange, onSaveRequest }: Props) {
  const [script,     setScript]     = useState(initialScript ?? WELCOME_SCRIPT);
  const [result,     setResult]     = useState<SolveResponse | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [showHelp,   setShowHelp]   = useState(false);
  const [activeView, setActiveView] = useState<'variables' | 'steps'>('variables');
  const textRef    = useRef<HTMLTextAreaElement>(null);
  const lineNumRef = useRef<HTMLDivElement>(null);

  // Sync line-number gutter scroll with textarea scroll
  const syncScroll = () => {
    if (textRef.current && lineNumRef.current) {
      lineNumRef.current.scrollTop = textRef.current.scrollTop;
    }
  };

  // If parent injects a saved script, apply it once
  useEffect(() => {
    if (initialScript) {
      setScript(initialScript);
      setResult(null);
      onScriptChange?.(initialScript);
    }
  }, [initialScript]);

  // Notify Dashboard of script text on every change
  const updateScript = (val: string) => {
    setScript(val);
    setResult(null);
    onScriptChange?.(val);
  };

  // Initialise Dashboard with starting script on mount
  useEffect(() => {
    onScriptChange?.(script);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl+Enter to solve
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); handleSolve(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const handleSolve = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await solveEquations(script);
      setResult(res);
      onResults?.(res);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'Solve failed.');
    } finally {
      setLoading(false);
    }
  }, [script, onResults]);

  // ── Line numbers ─────────────────────────────────────────────────────────
  const lines    = script.split('\n');
  const lineNums = lines.map((_, i) => i + 1);

  // ── Variable groups ──────────────────────────────────────────────────────
  const vars        = result?.variables ?? {};
  const numericVars = Object.entries(vars).filter(([, v]) => typeof v === 'number');
  const stringVars  = Object.entries(vars).filter(([, v]) => typeof v === 'string');

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: 'var(--tb-bg-base)' }}>

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5"
           style={{ borderBottom: '1px solid var(--tb-border)', background: 'var(--tb-bg-surface)' }}>

        <div className="flex items-center gap-2 mr-2">
          <Terminal className="w-4 h-4" style={{ color: 'var(--tb-accent)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--tb-text-primary)' }}>
            Equation Solver
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full"
                style={{ background: 'var(--tb-accent-subtle)', color: 'var(--tb-accent)',
                         border: '1px solid var(--tb-accent-border)' }}>
            TBS
          </span>
          {/* Steady State | Transient toggle */}
          <div
            className="flex items-center rounded-lg overflow-hidden text-xs font-semibold ml-2"
            style={{ border: '1px solid var(--tb-border)', background: 'var(--tb-bg-elevated)', height: 26 }}
          >
            <button
              onClick={() => onAnalysisModeChange?.('steady')}
              className="px-3 h-full flex items-center transition-colors"
              style={{
                background: analysisMode === 'steady' ? 'var(--tb-accent)' : 'transparent',
                color:      analysisMode === 'steady' ? '#fff' : 'var(--tb-text-muted)',
                border: 'none', cursor: 'pointer',
              }}
            >
              Steady State
            </button>
            <button
              onClick={() => onAnalysisModeChange?.('transient')}
              className="px-3 h-full flex items-center transition-colors"
              style={{
                background: analysisMode === 'transient' ? 'var(--tb-accent)' : 'transparent',
                color:      analysisMode === 'transient' ? '#fff' : 'var(--tb-text-muted)',
                border: 'none', cursor: 'pointer',
              }}
            >
              Transient
            </button>
          </div>
        </div>

        <div className="flex-1" />

        {/* ── Save script ── */}
        <button
          onClick={() => onSaveRequest ? onSaveRequest() : undefined}
          disabled={saving || !result}
          title={!result ? 'Solve first, then save' : 'Save this script and results'}
          className="tb-btn-ghost flex items-center gap-1.5"
          style={{ opacity: !result ? 0.4 : 1 }}
        >
          {saving
            ? <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
            : <Save className="w-3.5 h-3.5" />}
          Save
        </button>

        {/* ── Import script ── */}
        <label title="Import .tbs script" className="tb-btn-ghost flex items-center gap-1.5 cursor-pointer">
          <Upload className="w-3.5 h-3.5" /> Import
          <input type="file" accept=".tbs,.txt" className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = ev => {
                const text = ev.target?.result as string;
                if (text) { updateScript(text); setResult(null); }
              };
              reader.readAsText(file);
              e.target.value = '';
            }} />
        </label>

        {/* ── Export script ── */}
        <button
          title="Export script as .tbs"
          className="tb-btn-ghost flex items-center gap-1.5"
          onClick={() => {
            const blob = new Blob([script], { type: 'text/plain' });
            const a = Object.assign(document.createElement('a'), {
              href: URL.createObjectURL(blob),
              download: `thermobird_script_${Date.now()}.tbs`,
            });
            a.click();
          }}
        >
          <Download className="w-3.5 h-3.5" /> Export
        </button>

        <button onClick={() => setShowHelp(h => !h)}
                className={'tb-btn-ghost flex items-center gap-1.5' +
                  (showHelp ? ' !border-[var(--tb-accent)] !text-[var(--tb-accent)]' : '')}>
          <HelpCircle className="w-3.5 h-3.5" /> Help
        </button>

        {/* Solve */}
        <button
          onClick={handleSolve} disabled={loading || !script.trim()}
          className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all"
          style={loading || !script.trim()
            ? { background: 'var(--tb-bg-elevated)', color: 'var(--tb-text-muted)', cursor: 'not-allowed' }
            : { background: 'var(--tb-accent)', color: '#fff', boxShadow: '0 0 12px rgba(14,165,233,0.3)' }}>
          {loading
            ? <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
            : <Play className="w-3.5 h-3.5" />}
          {loading ? 'Solving…' : 'Solve'}
          {!loading && <span className="text-[10px] opacity-60 ml-1">Ctrl+↵</span>}
        </button>
      </div>

      {/* ── Error banner ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }}
                      className="flex-shrink-0 flex items-center gap-3 px-4 py-2.5 text-sm overflow-hidden"
                      style={{ background: 'rgba(239,68,68,0.08)', borderBottom: '1px solid rgba(239,68,68,0.2)' }}>
            <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: '#f87171' }} />
            <span style={{ color: '#fca5a5' }}>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto" style={{ color: '#f87171' }}>
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── Editor ─────────────────────────────────────────────────── */}
        <div className="flex flex-col" style={{
          width: result && showHelp ? 'calc(50% - 280px)' : result ? '50%' : showHelp ? 'calc(100% - 280px)' : '100%',
          transition: 'width 200ms ease',
          borderRight: '1px solid var(--tb-border)',
        }}>
          <div className="flex-1 flex overflow-hidden font-mono text-sm">
            {/* Line numbers */}
            <div
              ref={lineNumRef}
              className="select-none flex-shrink-0 pt-3 pb-3 text-right pr-3 pl-3 overflow-hidden"
              style={{
                background: 'var(--tb-bg-elevated)',
                borderRight: '1px solid var(--tb-border)',
                color: 'var(--tb-text-muted)',
                fontSize: '0.75rem',
                lineHeight: '1.5rem',
                minWidth: '3rem',
                userSelect: 'none',
                overflowY: 'hidden',
              }}>
              {lineNums.map(n => <div key={n}>{n}</div>)}
            </div>

            {/* Code textarea */}
            <textarea
              ref={textRef}
              value={script}
              onChange={e => updateScript(e.target.value)}
              onScroll={syncScroll}
              spellCheck={false}
              className="flex-1 resize-none focus:outline-none p-3"
              style={{
                background: 'var(--tb-bg-base)',
                color:      'var(--tb-text-primary)',
                fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
                fontSize:   '0.8rem',
                lineHeight: '1.5rem',
                tabSize:    2,
                border:     'none',
              }}
            />
          </div>

          {/* Status bar */}
          <div className="flex-shrink-0 flex items-center gap-4 px-3 py-1.5 text-xs"
               style={{ background: 'var(--tb-bg-elevated)', borderTop: '1px solid var(--tb-border)',
                        color: 'var(--tb-text-muted)' }}>
            <span>{lines.length} lines</span>
            <span>{script.length} chars</span>
            {result && (
              <>
                <span style={{ color: result.success ? '#34d399' : '#f87171' }}>
                  {result.success ? '✓ Solved' : `✗ ${result.errors.length} error(s)`}
                </span>
                <span>{result.execution_time_ms.toFixed(1)} ms</span>
              </>
            )}
          </div>
        </div>

        {/* ── Results panel ────────────────────────────────────────────── */}
        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ width: 0, opacity: 0 }} animate={{ width: '50%', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }} transition={{ duration: 0.2 }}
              className="flex flex-col overflow-hidden"
              style={{ background: 'var(--tb-bg-surface)' }}>

              {/* Sub-tab bar */}
              <div className="flex-shrink-0 flex items-center gap-0.5 px-3 pt-2"
                   style={{ borderBottom: '1px solid var(--tb-border)' }}>
                {(['variables', 'steps'] as const).map(v => (
                  <button key={v} onClick={() => setActiveView(v)}
                          className="px-3 py-1.5 text-xs font-medium rounded-t-lg border-b-2 -mb-px capitalize transition-colors"
                          style={activeView === v
                            ? { color: 'var(--tb-accent)', borderColor: 'var(--tb-accent)', background: 'var(--tb-bg-base)' }
                            : { color: 'var(--tb-text-muted)', borderColor: 'transparent' }}>
                    {v === 'variables'
                      ? `Variables (${Object.keys(vars).length})`
                      : `Steps (${result.steps.length})`}
                  </button>
                ))}
                <div className="flex-1" />
                {result.errors.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full mb-1"
                        style={{ background: 'rgba(248,113,113,0.12)', color: '#f87171',
                                 border: '1px solid rgba(248,113,113,0.3)' }}>
                    {result.errors.length} error{result.errors.length > 1 ? 's' : ''}
                  </span>
                )}
                {result.warnings.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full mb-1 ml-1"
                        style={{ background: 'rgba(251,191,36,0.10)', color: '#fbbf24',
                                 border: '1px solid rgba(251,191,36,0.25)' }}>
                    {result.warnings.length} warning{result.warnings.length > 1 ? 's' : ''}
                  </span>
                )}
                {/* Clear results — lets user start fresh without touching the code */}
                <button
                  onClick={() => { setResult(null); onResults?.(null as any); }}
                  title="Clear results"
                  className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-lg mb-1 ml-1"
                  style={{ color: '#f87171', background: 'rgba(248,113,113,0.08)',
                           border: '1px solid rgba(248,113,113,0.22)', cursor: 'pointer' }}>
                  <Trash2 className="w-3 h-3" /> Clear
                </button>
                {/* Dismiss / close the panel */}
                <button
                  onClick={() => setResult(null)}
                  title="Close results panel"
                  className="mb-1 ml-1 p-1 rounded-lg"
                  style={{ color: 'var(--tb-text-muted)', background: 'transparent',
                           border: 'none', cursor: 'pointer' }}>
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-4">
                {activeView === 'variables' && (
                  <div className="space-y-4">
                    {numericVars.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-widest mb-2"
                           style={{ color: 'var(--tb-text-muted)' }}>Numeric Variables</p>
                        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--tb-border)' }}>
                          <table className="w-full text-xs">
                            <thead>
                              <tr style={{ background: 'var(--tb-bg-elevated)' }}>
                                <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--tb-text-muted)' }}>Variable</th>
                                <th className="text-right px-3 py-2 font-medium" style={{ color: 'var(--tb-text-muted)' }}>Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {numericVars.map(([k, v]) => {
                                const { text, unit } = fmtWithUnitSolver(k, v as number);
                                return (
                                  <tr key={k} style={{ borderTop: '1px solid var(--tb-border-soft)' }}>
                                    <td className="px-3 py-1.5 font-mono" style={{ color: 'var(--tb-accent)' }}>{k}</td>
                                    <td className="px-3 py-1.5 text-right font-mono" style={{ color: 'var(--tb-text-primary)' }}>
                                      {text}
                                      {unit && <span className="ml-1 text-[9px] font-normal" style={{ color: 'var(--tb-text-muted)' }}>{unit}</span>}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                    {stringVars.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-widest mb-2"
                           style={{ color: 'var(--tb-text-muted)' }}>String Variables</p>
                        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--tb-border)' }}>
                          {stringVars.map(([k, v]) => (
                            <div key={k} className="flex items-center justify-between px-3 py-1.5 text-xs"
                                 style={{ borderBottom: '1px solid var(--tb-border-soft)' }}>
                              <span className="font-mono" style={{ color: '#a78bfa' }}>{k}</span>
                              <span className="font-mono" style={{ color: '#34d399' }}>'{v}'</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {result.errors.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-widest mb-2"
                           style={{ color: '#f87171' }}>Errors</p>
                        <div className="space-y-1.5">
                          {result.errors.map((e, i) => (
                            <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg text-xs"
                                 style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
                              <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: '#f87171' }} />
                              <span style={{ color: '#fca5a5' }}>{e}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {activeView === 'steps' && (
                  <div className="space-y-1.5">
                    {result.steps.map((step, i) => (
                      <motion.div key={i}
                        initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.015, duration: 0.15 }}
                        className="rounded-lg p-2.5"
                        style={{
                          background: step.ok ? 'rgba(52,211,153,0.05)' : 'rgba(248,113,113,0.07)',
                          border: `1px solid ${step.ok ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.25)'}`,
                        }}>
                        <div className="flex items-start gap-2">
                          <span className="text-[10px] mt-0.5 flex-shrink-0 w-6 text-right"
                                style={{ color: 'var(--tb-text-muted)' }}>{step.line}</span>
                          {step.ok
                            ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: '#34d399' }} />
                            : <XCircle      className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: '#f87171' }} />}
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-mono truncate" style={{ color: 'var(--tb-text-secondary)' }}>
                              {step.expr}
                            </p>
                            {step.ok && step.result != null && (
                              <p className="text-xs font-mono mt-0.5" style={{ color: '#34d399' }}>
                                {(() => {
                                  if (typeof step.result === 'number') {
                                    const { text, unit } = fmtWithUnitSolver(step.expr?.split('=')?.[0]?.trim() ?? '', step.result);
                                    return unit ? `→ ${text} ${unit}` : `→ ${text}`;
                                  }
                                  return `→ ${String(step.result)}`;
                                })()}
                              </p>
                            )}
                            {!step.ok && step.msg && (
                              <p className="text-xs mt-0.5" style={{ color: '#fca5a5' }}>{step.msg}</p>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Help sidebar ──────────────────────────────────────────────── */}
        <AnimatePresence>
          {showHelp && (
            <motion.div
              initial={{ width: 0, opacity: 0 }} animate={{ width: 280, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }} transition={{ duration: 0.18 }}
              className="flex-shrink-0 overflow-y-auto p-4"
              style={{ background: 'var(--tb-bg-surface)', borderLeft: '1px solid var(--tb-border)' }}>
              <HelpContent onClose={() => setShowHelp(false)} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatNum(v: number): string {
  const abs = Math.abs(v);
  if (!isFinite(v)) return String(v);
  if (abs === 0)              return '0';
  if (abs < 1e-4 || abs > 1e9) return v.toExponential(4);
  if (abs < 0.01)             return v.toFixed(6);
  if (abs < 100)              return v.toFixed(4);
  return v.toFixed(3);
}

// ── Help panel ────────────────────────────────────────────────────────────────

function HelpContent({ onClose }: { onClose: () => void }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-semibold" style={{ color: 'var(--tb-text-primary)' }}>TBS Syntax Guide</p>
        <button onClick={onClose} style={{ color: 'var(--tb-text-muted)' }}><X className="w-4 h-4" /></button>
      </div>

      <Section title="Comments">
        <Code>{`"This is a comment"\n{ block comment }`}</Code>
      </Section>
      <Section title="Variables">
        <Code>{`x = 5\nW_net = W_t - W_p\nFluid$ = 'R245fa'`}</Code>
      </Section>
      <Section title="Unit Annotations">
        <Code>{`T = 623.15 [K]\nP_boil = 3000 [kPa]\neta = 0.85`}</Code>
        <p className="text-xs mt-1" style={{ color: 'var(--tb-text-muted)' }}>
          Bracket annotations are informational — stripped by the parser.
        </p>
      </Section>
      <Section title="Script Units (Important!)">
        <div className="rounded-lg p-2.5 text-xs space-y-1"
             style={{ background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.25)' }}>
          {[
            ['Pressure',    'kPa',        'P_boil = 3000'],
            ['Temperature', 'K',          'T3 = 623.15'],
            ['Enthalpy',    'kJ/kg',      'h1 = enthalpy(...)'],
            ['Entropy',     'kJ/(kg·K)',  's1 = entropy(...)'],
            ['Int. Energy', 'kJ/kg',      'u = internal_energy(...)'],
            ['Quality',     '0 – 1',      'x1 = 0'],
          ].map(([qty, unit, ex]) => (
            <div key={qty} className="flex items-baseline gap-1.5">
              <span className="w-24 flex-shrink-0 font-medium" style={{ color: '#fbbf24' }}>{qty}</span>
              <span className="font-mono w-20 flex-shrink-0" style={{ color: 'var(--tb-accent)' }}>{unit}</span>
              <span style={{ color: 'var(--tb-text-muted)', fontSize: 10 }}>{ex}</span>
            </div>
          ))}
        </div>
        <p className="text-xs mt-2" style={{ color: 'var(--tb-text-muted)' }}>
          The solver converts kPa→Pa / kJ→J before CoolProp, and divides back automatically.
          Parametric sweep min/max must also use these same units.
        </p>
      </Section>
      <Section title="CoolProp Functions">
        <Code>{`h = enthalpy(Fluid$, P=P1, T=T1)\ns = entropy(Fluid$, P=P1, T=T1)\nT = temperature(Fluid$, P=P1, h=h1)\nv = volume(Fluid$, P=P1, x=x1)`}</Code>
      </Section>
      <Section title="Available Properties">
        {[
          ['enthalpy / h',       'Specific enthalpy → kJ/kg'],
          ['entropy / s',        'Specific entropy → kJ/(kg·K)'],
          ['temperature / t',    'Temperature → K'],
          ['pressure / p',       'Pressure → kPa'],
          ['density / d',        'Density → kg/m³'],
          ['volume / v',         'Specific volume → m³/kg'],
          ['quality / x',        'Vapour quality → 0–1'],
          ['internal_energy / u','Internal energy → kJ/kg'],
          ['cp',                 'Isobaric heat capacity'],
          ['cv',                 'Isochoric heat capacity'],
        ].map(([fn, desc]) => (
          <div key={fn} className="flex gap-2 text-xs mb-1">
            <span className="font-mono w-32 flex-shrink-0" style={{ color: 'var(--tb-accent)' }}>{fn}</span>
            <span style={{ color: 'var(--tb-text-muted)' }}>{desc}</span>
          </div>
        ))}
      </Section>
      <Section title="Math Builtins">
        <Code>{`sqrt, log, log10, exp\nabs, sin, cos, tan\npi, e`}</Code>
      </Section>
      <Section title="Tip: Global Save">
        <p className="text-xs" style={{ color: 'var(--tb-text-muted)' }}>
          After solving, press the <strong>Save</strong> button in the header (or Ctrl+S) to persist
          this script and its results to your account under My Simulations.
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest mb-1.5"
         style={{ color: 'var(--tb-text-muted)' }}>{title}</p>
      {children}
    </div>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="text-xs p-2.5 rounded-lg font-mono overflow-x-auto"
         style={{ background: 'var(--tb-bg-elevated)', color: 'var(--tb-text-secondary)',
                  lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
      {children}
    </pre>
  );
}
