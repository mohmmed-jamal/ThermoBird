/**
 * Dashboard — ThermoBird main workspace  v4
 * Classical minimalism × modern beauty
 */
import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Save, FlaskConical, LayoutDashboard, BarChart2, SlidersHorizontal,
  Sun, Moon, X, AlertTriangle, FolderOpen, Terminal, Upload, Download, Play, Trash2, FileText,
  Activity, Construction,
} from 'lucide-react';
import { useThemeStore }      from '../store/themeStore';
import { useAuthStore }      from '../store/authStore';
import { useUnitSystemStore } from '../store/unitSystemStore';
import { LogoMark } from '../components/ui/Logo';
import SimulationCanvas     from '../components/canvas/SimulationCanvas';
import ParametricAnalysis   from '../components/parametric/ParametricAnalysis';
import ResultsPanel         from '../components/results/ResultsPanel';
import PropertyCalculator   from '../components/property/PropertyCalculator';
import EquationSolver       from '../components/solver/EquationSolver';
import TransientResultsView from '../components/transient/TransientResults';
import { useCycleStore, inferCycleType } from '../store/cycleStore';
import { usePropertyCalcStore } from '../store/propertyCalculatorStore';
import { validateCanvas }   from '../lib/validateCanvas';
import {
  runSimulation as runSimulationAPI,
  saveCanvas as saveCanvasAPI,
  saveSolverScript,
  type SolveResponse,
} from '../lib/api';
import ErrorBoundary from '../components/error/ErrorBoundary';
import { ModeSwitcher } from '../components/mode/ModeSwitcher';
import { useModeStore } from '../store/modeStore';
import { useTransientStore } from '../store/transientStore';
import { fmtWithUnitSolver } from '../lib/units';
import { exportSolverCSV, exportSolverPDF } from '../lib/exportUtils';

type MainTab = 'properties' | 'solver' | 'canvas' | 'parametric' | 'transient' | 'results';

const MAIN_TABS: { id: MainTab; label: string; icon: React.ReactNode }[] = [
  { id: 'properties', label: 'Property Calculator', icon: <FlaskConical      className="w-3.5 h-3.5" /> },
  { id: 'solver',     label: 'Equation Solver',     icon: <Terminal          className="w-3.5 h-3.5" /> },
  { id: 'canvas',     label: 'Canvas',              icon: <LayoutDashboard   className="w-3.5 h-3.5" /> },
  { id: 'parametric', label: 'Parametric',          icon: <SlidersHorizontal className="w-3.5 h-3.5" /> },
  { id: 'transient',  label: 'Transient',           icon: <Activity          className="w-3.5 h-3.5" /> },
  { id: 'results',    label: 'Results',             icon: <BarChart2         className="w-3.5 h-3.5" /> },
];

type ResultSubTab = 'canvas' | 'solver' | 'transient';

function extractError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as any;
    const detail = e?.response?.data?.detail;
    if (detail) return typeof detail === 'string' ? detail : JSON.stringify(detail);
    const msg = e?.response?.data?.message || e?.response?.data?.error;
    if (msg) return msg;
    const st = e?.response?.status;
    if (st) return `Server returned ${st}. Check backend logs.`;
    if (e?.message) return e.message;
  }
  return 'An unexpected error occurred.';
}

// ── Feature gate map ─────────────────────────────────────────────────────────
// 'free'    = Educational Free + all above
// 'premium' = Educational Premium + Professional
// 'pro'     = Professional only
const TAB_GATE: Record<string, 'free' | 'premium' | 'pro'> = {
  properties: 'free',
  solver:     'free',
  canvas:     'premium',
  parametric: 'premium',
  transient:  'pro',
  results:    'free',
};

function tabIsLocked(id: string, mode: string, tier: string): boolean {
  const gate = TAB_GATE[id] ?? 'free';
  if (gate === 'free') return false;
  if (gate === 'pro')  return mode !== 'professional';
  if (gate === 'premium') return mode === 'educational' && tier === 'free';
  return false;
}

// ── Tiny animated tab indicator (sliding underline) ──────────────────────────
function TabBar({
  tabs, activeId, onSelect, getExtra,
}: {
  tabs: typeof MAIN_TABS;
  activeId: string;
  onSelect: (id: MainTab) => void;
  getExtra?: (id: string) => React.ReactNode;
}) {
  const mode           = useModeStore(s => s.mode);
  const educationalTier= useModeStore(s => s.educationalTier);
  return (
    <div className="flex items-end gap-0 px-4" style={{ position: 'relative' }}>
      {tabs.map(tab => {
        const active = activeId === tab.id;
        const locked = tabIsLocked(tab.id, mode, educationalTier);
        return (
          <button
            key={tab.id}
            onClick={() => { if (!locked) onSelect(tab.id); }}
            className="relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium"
            title={locked ? (TAB_GATE[tab.id] === 'pro' ? 'Professional mode required' : 'Educational Premium required') : undefined}
            style={{
              color: locked ? 'var(--tb-text-muted)' : active ? 'var(--tb-accent)' : 'var(--tb-text-muted)',
              background: 'transparent',
              border: 'none',
              cursor: locked ? 'not-allowed' : 'pointer',
              outline: 'none',
              opacity: locked ? 0.45 : 1,
              borderRadius: '8px 8px 0 0',
              transition: 'color 160ms ease',
            }}
            onMouseEnter={e => { if (!active && !locked) e.currentTarget.style.color = 'var(--tb-text-secondary)'; }}
            onMouseLeave={e => { if (!active && !locked) e.currentTarget.style.color = 'var(--tb-text-muted)'; }}
          >
            {tab.icon}
            {tab.label}
            {getExtra?.(tab.id)}
            {/* Lock badge */}
            {locked && (
              <span
                className="ml-1 text-[9px] px-1 py-0.5 rounded font-semibold"
                style={{
                  background: TAB_GATE[tab.id] === 'pro' ? 'rgba(129,140,248,0.15)' : 'rgba(245,158,11,0.15)',
                  color:      TAB_GATE[tab.id] === 'pro' ? '#818cf8' : '#f59e0b',
                  border:     `1px solid ${TAB_GATE[tab.id] === 'pro' ? 'rgba(129,140,248,0.3)' : 'rgba(245,158,11,0.3)'}`,
                }}
              >
                {TAB_GATE[tab.id] === 'pro' ? 'Pro' : 'Premium'}
              </span>
            )}
            {/* Sliding underline */}
            {active && !locked && (
              <motion.div
                layoutId="dashboard-tab-indicator"
                style={{
                  position: 'absolute', bottom: -1, left: 0, right: 0, height: 2,
                  background: 'linear-gradient(90deg, var(--tb-accent), #818cf8)',
                  borderRadius: '2px 2px 0 0',
                  boxShadow: '0 0 8px rgba(14,165,233,0.5)',
                }}
                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

export default function Dashboard() {
  const location  = useLocation();
  const navState  = (location.state ?? {}) as { tab?: MainTab; script?: string };

  const [activeTab,     setActiveTab]     = useState<MainTab>(navState.tab ?? 'properties');
  const [resultSubTab,  setResultSubTab]  = useState<ResultSubTab>('canvas');
  const [loading,       setLoading]       = useState(false);
  const [saving,        setSaving]        = useState(false);
  const [simError,      setSimError]      = useState<string | null>(null);
  const [saveError,     setSaveError]     = useState<string | null>(null);
  const [pendingRun,    setPendingRun]    = useState(false);

  // Per-source save modals
  const [showCanvasSaveModal, setShowCanvasSaveModal] = useState(false);
  const [canvasSaveName,      setCanvasSaveName]      = useState('');
  const [showSolverSaveModal, setShowSolverSaveModal] = useState(false);
  const [solverSaveName,      setSolverSaveName]      = useState('');

  // Analysis mode per source: 'steady' runs simulation, 'transient' opens Transient tab
  const [canvasMode, setCanvasMode] = useState<'steady' | 'transient'>('steady');
  const [solverMode, setSolverMode] = useState<'steady' | 'transient'>('steady');

  const [injectedScript, setInjectedScript] = useState<string | undefined>(navState.script);

  // Transient result — declared early so the auto-navigate useEffect can depend on it
  const transientResult    = useTransientStore(s => s.result);
  const hasTransientResult = !!transientResult;

  useEffect(() => {
    const state = (location.state ?? {}) as { tab?: MainTab; script?: string };
    if (state.tab) setActiveTab(state.tab);
    if (state.script !== undefined) setInjectedScript(state.script);
    window.history.replaceState({}, '');
  }, [location.key]);

  // Auto-navigate to Results > Transient when a transient job completes
  useEffect(() => {
    if (transientResult) {
      setResultSubTab('transient');
      setActiveTab('results');
    }
  }, [transientResult]);

  const components          = useCycleStore(s => s.components);
  const connections         = useCycleStore(s => s.connections);
  const currentSimulationId = useCycleStore(s => s.currentSimulationId);
  const simulationName      = useCycleStore(s => s.simulationName);
  const isDirty             = useCycleStore(s => s.isDirty);
  const markSaved           = useCycleStore(s => s.markSaved);
  const setSimulationName   = useCycleStore(s => s.setSimulationName);
  const canvasResults       = useCycleStore(s => s.canvasResults);
  const setCanvasResults    = useCycleStore(s => s.setCanvasResults);
  const solverResults       = useCycleStore(s => s.solverResults);
  const setSolverResults    = useCycleStore(s => s.setSolverResults);
  const solverScript        = useCycleStore(s => s.solverScript);
  const setSolverScript     = useCycleStore(s => s.setSolverScript);

  const { theme, toggle: toggleTheme }    = useThemeStore();
  const { unitSystem, toggle: toggleUnit } = useUnitSystemStore();
  const user     = useAuthStore(s => s.user);
  const navigate = useNavigate();

  const solverScriptRef = useRef<string>(''); // kept for legacy — use cycleStore.solverScript instead

  const initials = (() => {
    const name = user?.name || user?.full_name;
    if (name) {
      const p = name.trim().split(/\s+/);
      return p.length >= 2 ? (p[0][0] + p[p.length - 1][0]).toUpperCase() : p[0].slice(0, 2).toUpperCase();
    }
    return user?.email?.[0]?.toUpperCase() ?? '?';
  })();

  // Ctrl+S — no-op now (saves are per-source in each toolbar)
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') e.preventDefault();
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  // ── Canvas Save ───────────────────────────────────────────────────────────
  const openCanvasSave = () => {
    setCanvasSaveName(useCycleStore.getState().simulationName || '');
    setShowCanvasSaveModal(true);
  };

  const commitCanvasSave = async (name: string) => {
    const s = useCycleStore.getState();
    if (!s.components.length) return;
    setSaving(true); setSaveError(null); setShowCanvasSaveModal(false);
    try {
      const id = await saveCanvasAPI({
        simulationId: s.currentSimulationId,
        name: name.trim() || 'Untitled Canvas',
        cycleType: inferCycleType(s.components), fluid: s.fluid,
        massFlowRate: s.massFlowRate, deadStateT0: s.deadStateT0, deadStateP0: s.deadStateP0,
        components: s.components, connections: s.connections,
      });
      markSaved(id, name.trim() || 'Untitled Canvas');
    } catch (err) { setSaveError(extractError(err)); }
    finally { setSaving(false); }
  };

  // ── Solver Save ───────────────────────────────────────────────────────────
  const openSolverSave = () => {
    setSolverSaveName(useCycleStore.getState().simulationName || `Script ${new Date().toLocaleDateString()}`);
    setShowSolverSaveModal(true);
  };

  const commitSolverSave = async (name: string) => {
    const s = useCycleStore.getState();
    if (!s.solverScript.trim() || !s.solverResults) return;
    setSaving(true); setSaveError(null); setShowSolverSaveModal(false);
    try {
      await saveSolverScript(name.trim() || 'Untitled Script', s.solverScript, s.solverResults);
    } catch (err) { setSaveError(extractError(err)); }
    finally { setSaving(false); }
  };

  // ── Run Simulation (steady-state canvas) ─────────────────────────────────
  const handleRunSimulation = async () => {
    const s0 = useCycleStore.getState();
    const vr = validateCanvas(s0.components, s0.connections);
    if (!vr.ok) {
      setSimError(
        `Fix ${vr.errors.length} issue${vr.errors.length > 1 ? 's' : ''} before running: ` +
        vr.errors.map(e => e.message).join(' · ')
      );
      return;
    }
    setLoading(true); setSimError(null);
    try {
      const s = useCycleStore.getState();
      // Auto-save canvas with existing name (or prompt if brand-new)
      if (!s.simulationName.trim() && !s.currentSimulationId) {
        setLoading(false); setPendingRun(true); openCanvasSave(); return;
      }
      const name = s.simulationName.trim() || 'Untitled Simulation';
      const id   = await saveCanvasAPI({
        simulationId: s.currentSimulationId, name,
        cycleType: inferCycleType(s.components), fluid: s.fluid,
        massFlowRate: s.massFlowRate, deadStateT0: s.deadStateT0, deadStateP0: s.deadStateP0,
        components: s.components, connections: s.connections,
      });
      markSaved(id, s.simulationName);
      const data = await runSimulationAPI(id, {
        ambient_temperature: s.deadStateT0, ambient_pressure: s.deadStateP0,
        tolerance: 0.01, max_iterations: 100,
      });
      if (data && data.success === false) { setSimError(data.error_message || 'Simulation failed.'); return; }
      setCanvasResults(data);
      setResultSubTab('canvas');
      setActiveTab('results');
    } catch (err) { setSimError(extractError(err)); }
    finally { setLoading(false); }
  };

  // Called after canvas name is confirmed in the save modal when pendingRun=true
  const handleCanvasSaveConfirmForRun = async (name: string) => {
    setPendingRun(false);
    setShowCanvasSaveModal(false);
    useCycleStore.getState().setSimulationName(name.trim() || 'Untitled Simulation');
    setTimeout(() => handleRunSimulation(), 50);
  };

  const handleSolverResults = (r: SolveResponse) => {
    setSolverResults(r);
    setResultSubTab('solver');
    setActiveTab('results');
  };
  const handleSolverScriptChange = (s: string) => { setSolverScript(s); };

  const canRun          = components.length > 0 && connections.length > 0;
  const hasCanvasResult = !!canvasResults;
  const hasSolverResult = !!solverResults;

  const tabExtras = (id: string) => {
    if (id === 'transient' || id === 'parametric') {
      return (
        <span
          className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full font-semibold"
          style={{ background: 'rgba(245,158,11,0.14)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.32)' }}
        >
          Soon
        </span>
      );
    }
    if (id === 'results' && (hasCanvasResult || hasSolverResult || hasTransientResult)) {
      return (
        <motion.span
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full font-semibold"
          style={{ background: 'rgba(52,211,153,0.14)', color: '#34d399', border: '1px solid rgba(52,211,153,0.28)' }}
        >
          Ready
        </motion.span>
      );
    }
    return null;
  };

  return (
    <div className="dashboard-root h-screen flex flex-col">

      {/* ══ Header ══════════════════════════════════════════════════════════ */}
      <header className="flex-shrink-0 tb-header" style={{ zIndex: 50 }}>
        {/* Top row */}
        <div className="flex items-center justify-between px-5 py-2.5">

          {/* Brand */}
          <motion.div
            className="flex items-center gap-2.5 flex-shrink-0 cursor-pointer"
            onClick={() => navigate('/landing')}
            title="Go to Landing Page"
            whileHover={{ opacity: 0.85 }}
            whileTap={{ scale: 0.97 }}
          >
            <motion.div
              className="p-1.5 rounded-xl"
              style={{ background: 'var(--tb-accent-subtle)', border: '1px solid var(--tb-accent-border)' }}
              whileHover={{ scale: 1.08 }}
              transition={{ type: 'spring', stiffness: 320, damping: 18 }}
            >
              <LogoMark size={20} />
            </motion.div>
            <div className="hidden sm:flex flex-col leading-none">
              <span
                className="text-base font-bold"
                style={{ color: 'var(--tb-text-primary)', fontFamily: 'Outfit, Inter, sans-serif', letterSpacing: '-0.02em' }}
              >
                ThermoBird
              </span>
            </div>
          </motion.div>

          {/* Action bar */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Theme toggle */}
            <motion.button
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="tb-btn-ghost flex items-center justify-center w-8 h-8 !px-0"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={theme}
                  initial={{ rotate: -30, opacity: 0 }}
                  animate={{ rotate: 0, opacity: 1 }}
                  exit={{ rotate: 30, opacity: 0 }}
                  transition={{ duration: 0.22 }}
                >
                  {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </motion.div>
              </AnimatePresence>
            </motion.button>

            {/* Mode Switcher — Educational / Professional */}
            <ModeSwitcher />

            {/* Avatar */}
            <motion.button
              onClick={() => navigate('/profile')}
              title="My Profile"
              style={{
                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                background: 'linear-gradient(135deg, var(--tb-accent), #6366f1)',
                color: '#fff', fontSize: 11, fontWeight: 800,
                fontFamily: 'Outfit, Inter, sans-serif',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', border: 'none',
                boxShadow: '0 0 0 2px var(--tb-accent-subtle)',
              }}
              whileHover={{ scale: 1.08, boxShadow: '0 0 0 3px var(--tb-accent-border)' }}
              whileTap={{ scale: 0.95 }}
            >
              {initials}
            </motion.button>

            <button onClick={() => navigate('/simulations')} className="tb-btn-ghost flex items-center gap-1.5">
              <FolderOpen className="w-3.5 h-3.5" /> Open
            </button>
          </div>
        </div>

        {/* Tab bar — with layout-animated underline + unit toggle on right */}
        <div style={{
          borderTop: '1px solid var(--tb-header-sep)',
          boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.08)',
          background: 'var(--tb-bg-glass)',
          display: 'flex', alignItems: 'stretch',
        }}>
          <div className="flex-1">
            <TabBar tabs={MAIN_TABS} activeId={activeTab} onSelect={setActiveTab} getExtra={tabExtras} />
          </div>
          {/* Global SI ↔ Imperial toggle */}
          <div className="flex items-center pr-4">
            <motion.button
              onClick={toggleUnit}
              title={`Switch to ${unitSystem === 'SI' ? 'Imperial' : 'SI'} units`}
              whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.95 }}
              className="flex items-center gap-0 rounded-lg overflow-hidden text-xs font-semibold"
              style={{ border: '1px solid var(--tb-border)', background: 'var(--tb-bg-elevated', height: 28 }}
            >
              <span
                className="px-2.5 h-full flex items-center transition-colors"
                style={{
                  background: unitSystem === 'SI' ? 'var(--tb-accent)' : 'transparent',
                  color:      unitSystem === 'SI' ? '#fff' : 'var(--tb-text-muted)',
                }}
              >SI</span>
              <span
                className="px-2.5 h-full flex items-center transition-colors"
                style={{
                  background: unitSystem === 'Imperial' ? 'var(--tb-accent)' : 'transparent',
                  color:      unitSystem === 'Imperial' ? '#fff' : 'var(--tb-text-muted)',
                }}
              >Imperial</span>
            </motion.button>
          </div>
        </div>
      </header>

      {/* ══ Error banner ════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {(simError || saveError) && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex-shrink-0 flex items-start gap-3 px-5 py-3 text-sm overflow-hidden"
            style={{ background: 'rgba(239,68,68,0.07)', borderBottom: '1px solid rgba(239,68,68,0.22)' }}
          >
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#f87171' }} />
            <span className="flex-1 leading-relaxed" style={{ color: '#fca5a5' }}>
              <span className="font-semibold" style={{ color: '#f87171' }}>
                {saveError ? 'Save failed — ' : 'Simulation failed — '}
              </span>
              {saveError || simError}
            </span>
            <button
              onClick={() => { setSimError(null); setSaveError(null); }}
              className="flex-shrink-0 p-0.5 rounded"
              style={{ color: '#f87171' }}
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ══ Main content ════════════════════════════════════════════════════ */}
      <main className="flex-1 overflow-hidden tb-tab-area" style={{ background: 'var(--tb-tab-content-bg)' }}>

        {/* Property Calculator */}
        {activeTab === 'properties' && (
          <ErrorBoundary label="Property Calculator" fullHeight>
            <PropertyCalculator />
          </ErrorBoundary>
        )}

        {/* Equation Solver */}
        {activeTab === 'solver' && (
          <ErrorBoundary label="Equation Solver" fullHeight>
            <EquationSolver
              onResults={handleSolverResults}
              onScriptChange={handleSolverScriptChange}
              initialScript={injectedScript}
              analysisMode={solverMode}
              onAnalysisModeChange={(m) => {
                setSolverMode(m);
                if (m === 'transient') {
                  useTransientStore.getState().setSource('solver');
                  setActiveTab('transient');
                }
              }}
              onSaveRequest={openSolverSave}
            />
          </ErrorBoundary>
        )}

        {/* Canvas */}
        {activeTab === 'canvas' && (
          <div className="h-full flex flex-col">
            {/* Canvas toolbar */}
            <div
              className="flex-shrink-0 flex items-center justify-between px-4 py-2"
              style={{
                borderBottom: '1px solid var(--tb-border)',
                background: 'var(--tb-bg-surface)',
                boxShadow: 'var(--tb-panel-inset), 0 1px 0 var(--tb-header-sep)',
              }}
            >
              {/* Left: title + mode toggle */}
              <div className="flex items-center gap-3">
                <p className="text-sm font-semibold" style={{ color: 'var(--tb-text-primary)', fontFamily: 'Outfit, sans-serif' }}>
                  Simulation Canvas
                </p>
                {/* Steady State | Transient toggle */}
                <div
                  className="flex items-center rounded-lg overflow-hidden text-xs font-semibold"
                  style={{ border: '1px solid var(--tb-border)', background: 'var(--tb-bg-elevated)', height: 26 }}
                >
                  <button
                    onClick={() => setCanvasMode('steady')}
                    className="px-3 h-full flex items-center transition-colors"
                    style={{
                      background: canvasMode === 'steady' ? 'var(--tb-accent)' : 'transparent',
                      color:      canvasMode === 'steady' ? '#fff' : 'var(--tb-text-muted)',
                      border: 'none', cursor: 'pointer',
                    }}
                  >
                    Steady State
                  </button>
                  <button
                    onClick={() => { setCanvasMode('transient'); useTransientStore.getState().setSource('canvas'); setActiveTab('transient'); }}
                    className="px-3 h-full flex items-center transition-colors"
                    style={{
                      background: canvasMode === 'transient' ? 'var(--tb-accent)' : 'transparent',
                      color:      canvasMode === 'transient' ? '#fff' : 'var(--tb-text-muted)',
                      border: 'none', cursor: 'pointer',
                    }}
                  >
                    Transient
                  </button>
                </div>
              </div>

              {/* Right: actions */}
              <div className="flex items-center gap-2">
                {/* Save canvas */}
                <button
                  title="Save canvas"
                  className="tb-btn-ghost flex items-center gap-1.5"
                  onClick={openCanvasSave}
                  disabled={saving}
                >
                  {saving
                    ? <svg className="tb-animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                      </svg>
                    : <Save className="w-3.5 h-3.5" />}
                  Save
                  {isDirty && (
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ background: '#f59e0b', boxShadow: '0 0 6px rgba(245,158,11,0.6)' }} />
                  )}
                </button>

                {/* Import */}
                <label title="Import canvas (.json)" className="tb-btn-ghost flex items-center gap-1.5 cursor-pointer">
                  <Upload className="w-3.5 h-3.5" /> Import
                  <input type="file" accept=".json" className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = ev => {
                        try {
                          const data = JSON.parse(ev.target?.result as string);
                          if (data.components && data.connections) {
                            useCycleStore.getState().loadFromDB({
                              id: data.id ?? 0, name: data.name ?? 'Imported',
                              fluid: data.fluid, components: data.components, connections: data.connections,
                            });
                          }
                          // Restore property calculator state if present
                          if (data.propertyCalc) {
                            const pcs = usePropertyCalcStore.getState();
                            const pc  = data.propertyCalc;
                            if (pc.fluid)   pcs.setFluid(pc.fluid);
                            if (pc.pairIdx != null) pcs.setPairIdx(pc.pairIdx);
                            if (pc.val1 != null) pcs.setVal1(pc.val1);
                            if (pc.val2 != null) pcs.setVal2(pc.val2);
                            if (pc.sys)  pcs.setSys(pc.sys);
                            if (pc.result) pcs.setResult(pc.result);
                          }
                        } catch { setSimError('Invalid canvas file.'); }
                      };
                      reader.readAsText(file);
                      e.target.value = '';
                    }} />
                </label>

                {/* Export */}
                <button
                  title="Export canvas (.json)"
                  className="tb-btn-ghost flex items-center gap-1.5"
                  onClick={() => {
                    const s  = useCycleStore.getState();
                    const pc = usePropertyCalcStore.getState();
                    const blob = new Blob([JSON.stringify({
                      name: s.simulationName, fluid: s.fluid,
                      components: s.components, connections: s.connections,
                      propertyCalc: {
                        fluid:   pc.fluid,
                        pairIdx: pc.pairIdx,
                        val1:    pc.val1,
                        val2:    pc.val2,
                        sys:     pc.sys,
                        result:  pc.result,
                      },
                    }, null, 2)], { type: 'application/json' });
                    const a = Object.assign(document.createElement('a'), {
                      href: URL.createObjectURL(blob),
                      download: `${s.simulationName || 'canvas'}.json`,
                    });
                    a.click();
                  }}
                >
                  <Download className="w-3.5 h-3.5" /> Export
                </button>

                {/* Run Simulation — always runs steady state */}
                <motion.button
                  onClick={handleRunSimulation}
                  disabled={!canRun || loading}
                  whileHover={canRun && !loading ? { scale: 1.03 } : {}}
                  whileTap={canRun && !loading ? { scale: 0.97 } : {}}
                  className={
                    'flex items-center gap-2 px-4 py-1.5 rounded-xl text-sm font-semibold ' +
                    ((!canRun || loading) ? 'tb-btn-ghost opacity-45 cursor-not-allowed' : 'tb-btn-primary')
                  }
                >
                  {loading ? (
                    <>
                      <svg className="tb-animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                      </svg>
                      Running…
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5" fill="currentColor" />
                      Run Simulation
                    </>
                  )}
                </motion.button>
              </div>
            </div>

            <div className="flex-1 overflow-hidden">
              <ErrorBoundary label="Canvas" fullHeight onReset={() => useCycleStore.getState().clearCanvas()}>
                <SimulationCanvas />
              </ErrorBoundary>
            </div>
          </div>
        )}

        {/* Transient */}
        {activeTab === 'transient' && (
          <ErrorBoundary label="Transient Analysis" fullHeight>
            <TransientComingSoon />
          </ErrorBoundary>
        )}

        {/* Parametric — temporarily set to "coming soon", same treatment as Transient.
            The real implementation is left commented below, untouched, so it's a
            one-line swap to bring back: just restore the JSX and remove the
            ParametricComingSoon call. */}
        {activeTab === 'parametric' && (
          <ErrorBoundary label="Parametric Analysis" fullHeight>
            <ParametricComingSoon />
          </ErrorBoundary>
        )}
        {/*
        {activeTab === 'parametric' && (
          <ErrorBoundary label="Parametric Analysis" fullHeight>
            <ParametricAnalysis
              solverScript={solverScript}
              simulationId={currentSimulationId}
              canvasComponents={components}
              onStudySaved={() => {}}
              solverVariables={
                solverResults?.variables
                  ? Object.entries(solverResults.variables)
                      .filter(([, v]) => typeof v === 'number')
                      .map(([k]) => k)
                  : []
              }
            />
          </ErrorBoundary>
        )}
        */}

        {/* Results */}
        {activeTab === 'results' && (
          <div className="h-full flex flex-col">
            {/* Sub-tab bar */}
            <div
              className="flex-shrink-0 flex items-center gap-1 px-4 pt-2"
              style={{
                borderBottom: '1px solid var(--tb-border)',
                background: 'var(--tb-bg-surface)',
                boxShadow: 'var(--tb-panel-inset), 0 1px 0 var(--tb-header-sep)',
              }}
            >
              {([
                { id: 'canvas'    as ResultSubTab, label: 'Canvas Results',    has: hasCanvasResult },
                { id: 'solver'    as ResultSubTab, label: 'Solver Results',    has: hasSolverResult },
                { id: 'transient' as ResultSubTab, label: 'Transient Results', has: hasTransientResult },
              ]).map(st => {
                const active  = resultSubTab === st.id;
                const enabled = st.has;
                return (
                  <button
                    key={st.id}
                    onClick={() => enabled && setResultSubTab(st.id)}
                    className="relative flex items-center gap-2 px-4 py-2 text-xs font-medium"
                    style={{
                      color: active && enabled ? 'var(--tb-accent)' : enabled ? 'var(--tb-text-muted)' : 'var(--tb-text-muted)',
                      opacity: enabled ? 1 : 0.4,
                      cursor: enabled ? 'pointer' : 'not-allowed',
                      background: 'transparent', border: 'none', outline: 'none',
                    }}
                  >
                    {st.label}
                    {enabled
                      ? <span className="px-1.5 py-0.5 rounded-full text-[10px]"
                               style={{ background: 'rgba(52,211,153,0.13)', color: '#34d399', border: '1px solid rgba(52,211,153,0.28)' }}>
                          Ready
                        </span>
                      : <span className="px-1.5 py-0.5 rounded-full text-[10px]"
                               style={{ background: 'var(--tb-bg-elevated)', color: 'var(--tb-text-muted)' }}>
                          —
                        </span>}
                    {active && enabled && (
                      <motion.div
                        layoutId="results-subtab-indicator"
                        style={{
                          position: 'absolute', bottom: -1, left: 0, right: 0, height: 2,
                          background: 'linear-gradient(90deg, var(--tb-accent), #818cf8)',
                          borderRadius: '2px 2px 0 0',
                        }}
                        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                      />
                    )}
                  </button>
                );
              })}

              {/* Clear buttons — mirrored behaviour with canvas Clear */}
              <div className="flex-1" />
              {resultSubTab === 'canvas' && hasCanvasResult && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                  onClick={() => { setCanvasResults(null); }}
                  className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-lg mb-1"
                  style={{
                    color: '#f87171', background: 'rgba(248,113,113,0.08)',
                    border: '1px solid rgba(248,113,113,0.25)', cursor: 'pointer',
                  }}
                  title="Clear canvas results"
                >
                  <Trash2 className="w-3 h-3" /> Clear
                </motion.button>
              )}
              {resultSubTab === 'solver' && hasSolverResult && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                  onClick={() => { setSolverResults(null); }}
                  className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-lg mb-1"
                  style={{
                    color: '#f87171', background: 'rgba(248,113,113,0.08)',
                    border: '1px solid rgba(248,113,113,0.25)', cursor: 'pointer',
                  }}
                  title="Clear solver results"
                >
                  <Trash2 className="w-3 h-3" /> Clear
                </motion.button>
              )}
              {resultSubTab === 'transient' && hasTransientResult && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                  onClick={() => useTransientStore.getState().clearResult()}
                  className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-lg mb-1"
                  style={{
                    color: '#f87171', background: 'rgba(248,113,113,0.08)',
                    border: '1px solid rgba(248,113,113,0.25)', cursor: 'pointer',
                  }}
                  title="Clear transient results"
                >
                  <Trash2 className="w-3 h-3" /> Clear
                </motion.button>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              <AnimatePresence mode="wait">
                {resultSubTab === 'canvas' && (
                  <motion.div
                    key="canvas-results"
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}
                  >
                    {canvasResults ? (
                      <ErrorBoundary label="Canvas Results" onReset={() => setCanvasResults(null)}>
                        <ResultsPanel results={canvasResults} />
                      </ErrorBoundary>
                    ) : (
                      <EmptyResults
                        icon={<LayoutDashboard className="w-12 h-12" style={{ color: 'var(--tb-text-muted)' }} />}
                        title="No canvas results yet"
                        sub="Build a cycle on the Canvas tab and hit Run Simulation"
                      />
                    )}
                  </motion.div>
                )}
                {resultSubTab === 'solver' && (
                  <motion.div
                    key="solver-results"
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}
                  >
                    {solverResults ? (
                      <SolverResultsView results={solverResults} />
                    ) : (
                      <EmptyResults
                        icon={<Terminal className="w-12 h-12" style={{ color: 'var(--tb-text-muted)' }} />}
                        title="No solver results yet"
                        sub="Write a script in the Equation Solver tab and hit Solve"
                      />
                    )}
                  </motion.div>
                )}
                {resultSubTab === 'transient' && (
                  <motion.div
                    key="transient-results"
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}
                  >
                    {transientResult ? (
                      <TransientResultsView
                        result={transientResult}
                        onClear={() => useTransientStore.getState().clearResult()}
                      />
                    ) : (
                      <EmptyResults
                        icon={<Activity className="w-12 h-12" style={{ color: 'var(--tb-text-muted)' }} />}
                        title="No transient results yet"
                        sub="Run a simulation in the Transient tab to see time-series results here"
                      />
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </main>

      {/* ══ Canvas Save Modal ═══════════════════════════════════════════ */}
      <AnimatePresence>
        {showCanvasSaveModal && (
          <SaveModal
            title={pendingRun ? 'Name Your Canvas' : 'Save Canvas'}
            subtitle={pendingRun ? 'Give your canvas a name before running.' : 'Save the current canvas layout to your account.'}
            placeholder="Canvas name…"
            value={canvasSaveName}
            onChange={setCanvasSaveName}
            onConfirm={() => pendingRun
              ? handleCanvasSaveConfirmForRun(canvasSaveName)
              : commitCanvasSave(canvasSaveName)
            }
            confirmLabel={pendingRun ? 'Save & Run' : 'Save Canvas'}
            onCancel={() => { setShowCanvasSaveModal(false); setPendingRun(false); }}
          />
        )}
      </AnimatePresence>

      {/* ══ Solver Save Modal ════════════════════════════════════════════ */}
      <AnimatePresence>
        {showSolverSaveModal && (
          <SaveModal
            title="Save Script"
            subtitle="Save this TBS script and its results to your account."
            placeholder="Script name…"
            value={solverSaveName}
            onChange={setSolverSaveName}
            onConfirm={() => commitSolverSave(solverSaveName)}
            confirmLabel="Save Script"
            onCancel={() => setShowSolverSaveModal(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper components
// ─────────────────────────────────────────────────────────────────────────────

function EmptyResults({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="flex flex-col items-center justify-center h-full min-h-80 gap-4 p-8"
    >
      <div style={{ opacity: 0.35 }}>{icon}</div>
      <p className="font-semibold text-base" style={{ color: 'var(--tb-text-secondary)', fontFamily: 'Outfit, sans-serif' }}>
        {title}
      </p>
      <p className="text-sm text-center max-w-sm" style={{ color: 'var(--tb-text-muted)' }}>{sub}</p>
    </motion.div>
  );
}

function TransientComingSoon() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28 }}
      className="h-full flex items-center justify-center p-8"
      style={{ background: 'var(--tb-bg-base)' }}
    >
      <div
        className="w-full max-w-2xl rounded-2xl p-7"
        style={{
          background: 'var(--tb-bg-surface)',
          border: '1px solid var(--tb-border)',
          boxShadow: 'var(--tb-panel-inset)',
        }}
      >
        <div className="flex items-center gap-3 mb-3">
          <div
            className="p-2 rounded-xl"
            style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.35)' }}
          >
            <Construction className="w-5 h-5" style={{ color: '#f59e0b' }} />
          </div>
          <div>
            <p className="text-lg font-bold" style={{ color: 'var(--tb-text-primary)', fontFamily: 'Outfit, sans-serif' }}>
              Transient Analysis is coming soon
            </p>
            <p className="text-sm" style={{ color: 'var(--tb-text-muted)' }}>
              We are hardening the solver pipeline for larger multi-loop systems and long-horizon runs.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 mt-5">
          {[
            'Dynamic component auto-detection from Canvas and Equation Solver inputs',
            'Improved stability for stiff thermodynamic ODE systems',
            'Full energy/exergy/entropy consistency checks per timestep',
            'Faster execution path for large trigeneration configurations',
          ].map((item) => (
            <div
              key={item}
              className="rounded-xl px-3 py-2 text-xs"
              style={{ background: 'var(--tb-bg-elevated)', border: '1px solid var(--tb-border-soft)', color: 'var(--tb-text-secondary)' }}
            >
              {item}
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

// ── Parametric "coming soon" placeholder ─────────────────────────────────────
// Mirrors TransientComingSoon above. The real <ParametricAnalysis /> is still
// wired up and imported — only its render call in the tab switch is swapped
// out, so re-enabling it later is a two-line change there, not a rewrite here.
function ParametricComingSoon() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28 }}
      className="h-full flex items-center justify-center p-8"
      style={{ background: 'var(--tb-bg-base)' }}
    >
      <div
        className="w-full max-w-2xl rounded-2xl p-7"
        style={{
          background: 'var(--tb-bg-surface)',
          border: '1px solid var(--tb-border)',
          boxShadow: 'var(--tb-panel-inset)',
        }}
      >
        <div className="flex items-center gap-3 mb-3">
          <div
            className="p-2 rounded-xl"
            style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.35)' }}
          >
            <Construction className="w-5 h-5" style={{ color: '#f59e0b' }} />
          </div>
          <div>
            <p className="text-lg font-bold" style={{ color: 'var(--tb-text-primary)', fontFamily: 'Outfit, sans-serif' }}>
              Parametric Analysis is coming soon
            </p>
            <p className="text-sm" style={{ color: 'var(--tb-text-muted)' }}>
              Reworking sweep handling so it stays consistent across Canvas and Equation Solver sources.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 mt-5">
          {[
            'Sweep any solver or canvas variable across a defined range',
            'Consistent inputs shared with the source simulation, no re-entry',
            'Chart and table views of results across the swept range',
            'Saved studies you can revisit alongside their source simulation',
          ].map((item) => (
            <div
              key={item}
              className="rounded-xl px-3 py-2 text-xs"
              style={{ background: 'var(--tb-bg-elevated)', border: '1px solid var(--tb-border-soft)', color: 'var(--tb-text-secondary)' }}
            >
              {item}
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

// ── Reusable save modal ───────────────────────────────────────────────────────
function SaveModal({ title, subtitle, placeholder, value, onChange, onConfirm, confirmLabel, onCancel }: {
  title:        string;
  subtitle:     string;
  placeholder:  string;
  value:        string;
  onChange:     (v: string) => void;
  onConfirm:    () => void;
  confirmLabel: string;
  onCancel:     () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
      onClick={onCancel}
    >
      <motion.div
        initial={{ scale: 0.94, y: 12, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.94, y: 12, opacity: 0 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
        onClick={e => e.stopPropagation()}
        className="rounded-2xl p-6 w-96 shadow-2xl"
        style={{
          background: 'var(--tb-bg-surface)',
          border: '1px solid var(--tb-border)',
          boxShadow: 'var(--tb-panel-inset), 0 0 0 1px rgba(14,165,233,0.08), 0 24px 64px rgba(0,0,0,0.5)',
        }}
      >
        <p className="text-base font-bold mb-1" style={{ color: 'var(--tb-text-primary)', fontFamily: 'Outfit, sans-serif' }}>
          {title}
        </p>
        <p className="text-xs mb-4" style={{ color: 'var(--tb-text-muted)' }}>{subtitle}</p>
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus
          onKeyDown={e => { if (e.key === 'Enter') onConfirm(); if (e.key === 'Escape') onCancel(); }}
          className="tb-input mb-4"
        />
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 py-2 rounded-xl text-sm tb-btn-ghost">
            Cancel
          </button>
          <motion.button
            onClick={onConfirm}
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
            className="flex-1 py-2 rounded-xl text-sm font-semibold tb-btn-primary"
          >
            {confirmLabel}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function SolverResultsView({ results }: { results: SolveResponse }) {
  const scriptName    = useCycleStore(s => s.simulationName) || 'solver';
  const numericVars   = Object.entries(results.variables).filter(([, v]) => typeof v === 'number');
  const stringVars    = Object.entries(results.variables).filter(([, v]) => typeof v === 'string');

  return (
    <div className="p-5 space-y-5" style={{ background: 'var(--tb-bg-base)' }}>

      {/* ── Export toolbar ───────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button
          onClick={() => exportSolverCSV(results.variables, scriptName)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px',
                   borderRadius: 0, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                   background: 'var(--tb-bg-elevated)', color: 'var(--tb-text-secondary)',
                   border: '1px solid var(--tb-border)' }}
        >
          <Download className="w-3 h-3" /> Export CSV
        </button>
        <button
          onClick={() => exportSolverPDF(results, scriptName)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 14px',
                   borderRadius: 0, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                   background: 'linear-gradient(135deg, var(--tb-accent), #818cf8)',
                   color: '#fff', border: 'none' }}
        >
          <FileText className="w-3 h-3" /> Export PDF
        </button>
      </div>

      {/* Summary */}
      <motion.div
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-4 p-4 rounded-xl"
        style={{
          background: results.success ? 'rgba(52,211,153,0.06)' : 'rgba(248,113,113,0.07)',
          border: `1px solid ${results.success ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.25)'}`,
        }}
      >
        <span className="text-lg">{results.success ? '✓' : '✗'}</span>
        <div>
          <p className="text-sm font-semibold" style={{ color: results.success ? '#34d399' : '#f87171' }}>
            {results.success ? 'Script solved successfully' : `Solved with ${results.errors.length} error(s)`}
          </p>
          <p className="text-xs" style={{ color: 'var(--tb-text-muted)' }}>
            {Object.keys(results.variables).length} variables · {results.steps.length} steps · {results.execution_time_ms.toFixed(1)} ms
          </p>
        </div>
      </motion.div>

      {/* Numeric vars */}
      {numericVars.length > 0 && (
        <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--tb-border)' }}>
          <div
            className="px-4 py-2.5 text-xs font-semibold uppercase tracking-widest"
            style={{ background: 'var(--tb-bg-surface)', color: 'var(--tb-text-muted)', borderBottom: '1px solid var(--tb-border)' }}
          >
            Numeric Variables ({numericVars.length})
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {numericVars.map(([k, v], i) => {
              const { text, unit } = fmtWithUnitSolver(k, v as number);
              return (
                <motion.div
                  key={k}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.025 }}
                  className="px-4 py-2.5 flex items-center justify-between gap-2"
                  style={{
                    borderBottom: '1px solid var(--tb-border-soft)',
                    background: i % 2 === 0 ? 'var(--tb-bg-surface)' : 'var(--tb-bg-base)',
                  }}
                >
                  <span className="font-mono text-xs" style={{ color: 'var(--tb-accent)' }}>{k}</span>
                  <span className="font-mono text-xs font-semibold text-right" style={{ color: 'var(--tb-text-primary)' }}>
                    {text}
                    {unit && <span className="ml-1 text-[9px] font-normal" style={{ color: 'var(--tb-text-muted)' }}>{unit}</span>}
                  </span>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {/* String vars */}
      {stringVars.length > 0 && (
        <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--tb-border)' }}>
          <div
            className="px-4 py-2.5 text-xs font-semibold uppercase tracking-widest"
            style={{ background: 'var(--tb-bg-surface)', color: 'var(--tb-text-muted)', borderBottom: '1px solid var(--tb-border)' }}
          >
            String Variables
          </div>
          {stringVars.map(([k, v]) => (
            <div key={k} className="flex items-center gap-4 px-4 py-2.5 text-xs"
                 style={{ borderBottom: '1px solid var(--tb-border-soft)', background: 'var(--tb-bg-surface)' }}>
              <span className="font-mono" style={{ color: '#a78bfa' }}>{k}</span>
              <span className="font-mono" style={{ color: '#34d399' }}>'{v}'</span>
            </div>
          ))}
        </div>
      )}

      {/* Errors */}
      {results.errors.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#f87171' }}>Errors</p>
          {results.errors.map((e, i) => (
            <div key={i} className="flex items-start gap-2 p-3 rounded-xl text-xs"
                 style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.24)' }}>
              <span style={{ color: '#f87171' }}>✗</span>
              <span style={{ color: '#fca5a5' }}>{e}</span>
            </div>
          ))}
        </div>
      )}

      <p className="text-center text-xs" style={{ color: 'var(--tb-text-muted)' }}>
        Executed in {results.execution_time_ms.toFixed(1)} ms · ThermoBird Equation Solver
      </p>
    </div>
  );
}
