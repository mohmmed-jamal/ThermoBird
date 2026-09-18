/**
 * ParametricAnalysis — ThermoBird Parametric Sweep Tab  v6
 *
 * • Single sweep variable with range or custom-list mode
 * • Output selector: dropdown with checkboxes (auto-detect when none selected)
 * • kJ / kPa display units throughout
 * • Full Zustand persistence via useParametricStore
 * • Transposed results table: variables as rows, sweep steps as columns
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  FolderOpen, ChevronDown, ChevronUp,
  BarChart3, Table2, AlertTriangle, X, Sliders,
  TrendingUp, Zap, Info, RefreshCw, CheckSquare, Square, ListFilter,
} from 'lucide-react';
import {
  runParametric, listParametric,
  type SweepVariable, type OutputKPI,
  type ParametricRunResponse, type ParametricStudyRow,
} from '../../lib/api';
import { useParametricStore, type SweepVarDraft, type SourceType } from '../../store/parametricStore';
import { inferDisplayUnitSolver, fmtWithUnitSolver } from '../../lib/units';

// ── Colour palette ──────────────────────────────────────────────────────────
const SERIES_COLORS = [
  '#0ea5e9', '#34d399', '#f97316', '#a78bfa', '#fbbf24',
  '#f43f5e', '#22d3ee', '#84cc16', '#e879f9', '#fb923c',
];

interface Props {
  solverScript?:   string;
  simulationId?:   number | null;
  canvasComponents?: Array<{
    id: string;
    type: string;
    name?: string;
    parameters?: Record<string, any>;
  }>;
  onStudySaved?:   (id: number) => void;
  solverVariables?: string[];   // numeric variable names known from the last solver run
}

// ─────────────────────────────────────────────────────────────────────────────
export default function ParametricAnalysis({
  solverScript, simulationId, canvasComponents = [], onStudySaved, solverVariables = [],
}: Props) {
  // ── Persistent state ──────────────────────────────────────────────────────
  const {
    sourceType, studyName, sweepVar, selectedOutputs,
    genPlots, saveStudy, result,
    setSourceType, setStudyName, setSweepVar, setSelectedOutputs,
    setGenPlots, setSaveStudy, setResult,
  } = useParametricStore();

  // ── Local UI state ────────────────────────────────────────────────────────
  const [loading,        setLoading]        = useState(false);
  const [runError,       setRunError]       = useState<string | null>(null);
  const [activeView,     setActiveView]     = useState<'table' | 'chart'>('table');
  const [expandedVars,   setExpandedVars]   = useState(true);
  const [showOpenModal,  setShowOpenModal]  = useState(false);
  const [savedStudies,   setSavedStudies]   = useState<ParametricStudyRow[]>([]);
  const [loadingStudies, setLoadingStudies] = useState(false);
  const [outputOpen,     setOutputOpen]     = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);

  // Close output dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (outputRef.current && !outputRef.current.contains(e.target as Node))
        setOutputOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Available outputs = all solver variables MINUS the selected sweep variable
  const resultOutputNames: string[] = result
    ? Object.keys(result.outputs).filter(n => !result.axes.some(a => a.name === n))
    : [];
  const availableOutputs: string[] = resultOutputNames.length > 0
    ? resultOutputNames
    : solverVariables.filter(n => n !== sweepVar.name);

  const canvasSweepVariables = (() => {
    const out = new Set<string>();
    for (const c of canvasComponents) {
      const params = c.parameters || {};
      for (const [k, v] of Object.entries(params)) {
        if (typeof v !== 'number' || Number.isNaN(v)) continue;
        out.add(`${c.type}.${k}`);
        out.add(`${c.id}.${k}`);
        if (c.name?.trim()) out.add(`${c.name.trim()}.${k}`);
      }
    }
    return Array.from(out).sort((a, b) => a.localeCompare(b));
  })();

  const sweepVariableChoices = sourceType === 'canvas' ? canvasSweepVariables : solverVariables;

  // ── Run count ────────────────────────────────────────────────────────────
  function calcRuns(v: SweepVarDraft) {
    if (!v.name.trim()) return 0;
    if (v.mode === 'range') return Math.max(parseInt(v.steps) || 0, 2);
    return Math.max(v.values.split(',').map(s => s.trim()).filter(Boolean).length, 1);
  }
  const totalRuns = calcRuns(sweepVar);

  const updateVar = (patch: Partial<SweepVarDraft>) =>
    setSweepVar({ ...sweepVar, ...patch });

  // ── Build API request ─────────────────────────────────────────────────────
  function buildRequest() {
    const v = sweepVar;
    const builtVar: SweepVariable = v.mode === 'range'
      ? { name: v.name.trim(), label: v.label.trim() || v.name.trim(),
          min: parseFloat(v.min), max: parseFloat(v.max), steps: parseInt(v.steps) }
      : { name: v.name.trim(), label: v.label.trim() || v.name.trim(),
          values: v.values.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n)) };

    const builtOutputs: OutputKPI[] = selectedOutputs.length > 0
      ? selectedOutputs.map(name => ({ name, label: name }))
      : [];

    return {
      name: studyName.trim() || 'Parametric Study',
      source_type: sourceType,
      script: sourceType === 'solver' ? (solverScript || '') : undefined,
      simulation_id: sourceType === 'canvas' ? (simulationId ?? undefined) : undefined,
      variables: [builtVar],
      outputs: builtOutputs.length > 0 ? builtOutputs : undefined,
      generate_plots: genPlots,
      save_study: saveStudy,
    };
  }

  // ── Run ───────────────────────────────────────────────────────────────────
  const handleRun = async () => {
    setLoading(true); setRunError(null); setResult(null);
    try {
      const res = await runParametric(buildRequest() as any);
      setResult(res);
      setActiveView(genPlots && res.plot_data?.type !== 'table_only' ? 'chart' : 'table');
      if (res.study_id) onStudySaved?.(res.study_id);
    } catch (err: any) {
      setRunError(err?.response?.data?.detail || err?.message || 'Run failed');
    } finally { setLoading(false); }
  };

  // ── Open saved studies ────────────────────────────────────────────────────
  const openSavedStudies = async () => {
    setShowOpenModal(true); setLoadingStudies(true);
    try { setSavedStudies(await listParametric()); }
    catch { setSavedStudies([]); }
    finally { setLoadingStudies(false); }
  };

  const loadStudy = (row: ParametricStudyRow) => {
    setStudyName(row.name);
    setSourceType(row.source_type as SourceType);
    setGenPlots(row.generate_plots);
    if (row.variables_config?.length) {
      const vc = row.variables_config[0] as any;
      setSweepVar({
        id: `v_l_0`, name: vc.name || '', label: vc.label || '',
        mode: vc.values ? 'list' : 'range',
        min: String(vc.min ?? ''), max: String(vc.max ?? ''),
        steps: String(vc.steps ?? '10'),
        values: vc.values ? vc.values.join(', ') : '',
      });
    }
    if (row.output_config?.length)
      setSelectedOutputs(row.output_config.map((o: any) => o.name));
    if (row.result_matrix) {
      setResult({
        study_id: row.id, name: row.name,
        axes: row.result_matrix.axes || [],
        outputs: row.result_matrix.outputs || {},
        run_count: row.result_matrix.run_count || 0,
        success_count: row.result_matrix.success_count || 0,
        error_count: row.result_matrix.error_count || 0,
        execution_time_ms: row.execution_time_ms || 0,
        plot_data: row.plot_data || null,
        errors: [],
      });
      setActiveView('table');
    }
    setShowOpenModal(false);
  };

  const canRun = sweepVar.name.trim() !== '' && !loading &&
    (sourceType === 'canvas' ? !!simulationId : !!solverScript?.trim());

  // ── Toggle output selection ───────────────────────────────────────────────
  const toggleOutput = (name: string) => {
    setSelectedOutputs(
      selectedOutputs.includes(name)
        ? selectedOutputs.filter(n => n !== name)
        : [...selectedOutputs, name]
    );
  };
  const clearOutputs = () => setSelectedOutputs([]);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: 'var(--tb-bg-base)' }}>

      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 py-2.5"
           style={{ borderBottom: '1px solid var(--tb-border)', background: 'var(--tb-bg-surface)' }}>
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg"
               style={{ background: 'linear-gradient(135deg,rgba(14,165,233,.15),rgba(168,139,250,.15))',
                        border: '1px solid rgba(14,165,233,.25)' }}>
            <Sliders className="w-4 h-4" style={{ color: 'var(--tb-accent)' }} />
          </div>
          <span className="text-sm font-bold"
                style={{ color: 'var(--tb-text-primary)', fontFamily: 'Outfit,Inter,sans-serif' }}>
            Parametric Analysis
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full"
                style={{ background: 'var(--tb-accent-subtle)', color: 'var(--tb-accent)',
                         border: '1px solid var(--tb-accent-border)' }}>BETA</span>
        </div>
        <div className="flex items-center gap-2">
          <input value={studyName} onChange={e => setStudyName(e.target.value)}
                 placeholder="Study name…"
                 className="rounded-lg px-3 py-1.5 text-sm focus:outline-none"
                 style={{ background: 'var(--tb-bg-elevated)', border: '1px solid var(--tb-border)',
                          color: 'var(--tb-text-primary)', width: 180 }} />
          <button onClick={openSavedStudies} className="tb-btn-ghost flex items-center gap-1.5">
            <FolderOpen className="w-3.5 h-3.5" /> Open
          </button>
          <motion.button whileTap={{ scale: 0.97 }} onClick={handleRun} disabled={!canRun}
                         className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all"
                         style={!canRun
                           ? { background: 'var(--tb-bg-elevated)', color: 'var(--tb-text-muted)', cursor: 'not-allowed' }
                           : { background: 'linear-gradient(135deg,#0ea5e9,#6366f1)', color: '#fff',
                               boxShadow: '0 0 20px rgba(14,165,233,.35)' }}>
            {loading
              ? <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
              : <Zap className="w-3.5 h-3.5" />}
            {loading ? `Running ${totalRuns} cases…` : `Run ${totalRuns} cases`}
          </motion.button>
        </div>
      </div>

      {/* Error banner */}
      <AnimatePresence>
        {runError && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }}
                      className="flex-shrink-0 flex items-center gap-3 px-5 py-2.5 text-sm overflow-hidden"
                      style={{ background: 'rgba(239,68,68,.08)', borderBottom: '1px solid rgba(239,68,68,.2)' }}>
            <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: '#f87171' }} />
            <span style={{ color: '#fca5a5' }}>{runError}</span>
            <button onClick={() => setRunError(null)} className="ml-auto" style={{ color: '#f87171' }}>
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── Config panel ─────────────────────────────────────────────── */}
        <div className="flex-shrink-0 overflow-y-auto"
             style={{ width: result ? 320 : 400, borderRight: '1px solid var(--tb-border)',
                      background: 'var(--tb-bg-surface)', transition: 'width 250ms ease' }}>

          {/* Source */}
          <SectionHeader title="Source" icon={<TrendingUp className="w-3.5 h-3.5"/>} />
          <div className="px-4 py-3">
            <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: 'var(--tb-border)' }}>
              {(['solver', 'canvas'] as SourceType[]).map(t => (
                <button key={t} onClick={() => setSourceType(t)}
                        className="flex-1 py-1.5 text-xs font-medium transition-colors"
                        style={sourceType === t
                          ? { background: 'var(--tb-accent)', color: '#fff' }
                          : { background: 'var(--tb-bg-elevated)', color: 'var(--tb-text-muted)' }}>
                  {t === 'solver' ? '📝 Equation Solver' : '🖼 Canvas'}
                </button>
              ))}
            </div>
            {sourceType === 'solver' && !solverScript?.trim() && (
              <p className="mt-2 text-xs flex items-center gap-1" style={{ color: '#fbbf24' }}>
                <Info className="w-3 h-3"/> Load a solver script first
              </p>
            )}
            {sourceType === 'canvas' && (
              <p className="mt-2 text-xs flex items-center gap-1" style={{ color: simulationId ? '#34d399' : '#fbbf24' }}>
                <Info className="w-3 h-3"/>
                {simulationId
                  ? 'Canvas sweep uses saved simulation topology and component parameters'
                  : 'Save canvas first to enable canvas parametric sweep'}
              </p>
            )}
          </div>

          {/* Sweep Variable (single) */}
          <SectionHeader
            title="Sweep Variable"
            icon={<Sliders className="w-3.5 h-3.5"/>}
            expanded={expandedVars}
            onToggle={() => setExpandedVars(!expandedVars)}
          />
          <AnimatePresence>
            {expandedVars && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }}>
                <div className="px-4 pt-3 pb-4">
                  <div className="rounded-xl p-3"
                       style={{ background: 'var(--tb-bg-elevated)', border: `1px solid ${SERIES_COLORS[0]}44` }}>

                    {/* Variable name — dropdown from solved variables */}
                    <div className="mb-2">
                      <p className="text-[10px] mb-0.5" style={{ color: 'var(--tb-text-muted)' }}>
                        Sweep variable
                      </p>
                      {sweepVariableChoices.length > 0 ? (
                        <div style={{ position: 'relative' }}>
                          <select
                            value={sweepVar.name}
                            onChange={e => {
                              const name = e.target.value;
                              updateVar({ name, label: name });
                            }}
                            className="w-full rounded-lg px-2.5 py-1.5 text-xs focus:outline-none font-mono appearance-none"
                            style={{
                              background: 'var(--tb-bg-base)', border: '1px solid var(--tb-border)',
                              color: SERIES_COLORS[0], paddingRight: 28, cursor: 'pointer',
                            }}>
                            <option value="">— select variable —</option>
                            {sweepVariableChoices.map(v => (
                              <option key={v} value={v}>{v}</option>
                            ))}
                          </select>
                          <ListFilter className="pointer-events-none"
                            style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                                     width: 12, height: 12, color: SERIES_COLORS[0] }} />
                        </div>
                      ) : (
                        <div className="rounded-lg px-2.5 py-1.5 text-xs flex items-center gap-2"
                             style={{ background: 'var(--tb-bg-base)', border: '1px solid var(--tb-border)',
                                      color: 'var(--tb-text-muted)' }}>
                          <Info className="w-3 h-3 flex-shrink-0" style={{ color: '#fbbf24' }}/>
                          {sourceType === 'canvas'
                            ? 'Configure numeric component parameters on canvas to see sweep variables'
                            : 'Run the solver first to see variables'}
                        </div>
                      )}
                    </div>

                    {/* Display label */}
                    <div className="mb-2">
                      <p className="text-[10px] mb-0.5" style={{ color: 'var(--tb-text-muted)' }}>Display label (optional)</p>
                      <input value={sweepVar.label}
                             onChange={e => updateVar({ label: e.target.value })}
                             placeholder={sweepVar.name || 'e.g. Boiler Pressure'}
                             className="w-full rounded-lg px-2.5 py-1.5 text-xs focus:outline-none"
                             style={{ background: 'var(--tb-bg-base)', border: '1px solid var(--tb-border)',
                                      color: 'var(--tb-text-secondary)' }} />
                    </div>

                    {/* Range / List toggle */}
                    <div className="flex rounded-lg overflow-hidden border mb-2"
                         style={{ borderColor: 'var(--tb-border)' }}>
                      {(['range', 'list'] as const).map(m => (
                        <button key={m} onClick={() => updateVar({ mode: m })}
                                className="flex-1 py-1 text-xs capitalize transition-colors"
                                style={sweepVar.mode === m
                                  ? { background: SERIES_COLORS[0] + '22', color: SERIES_COLORS[0] }
                                  : { background: 'var(--tb-bg-base)', color: 'var(--tb-text-muted)' }}>
                          {m === 'range' ? 'Range' : 'Custom List'}
                        </button>
                      ))}
                    </div>

                    {sweepVar.mode === 'range' ? (
                      <div>
                        {/* Unit reminder */}
                        {inferDisplayUnitSolver(sweepVar.name) && (
                          <p className="text-[10px] mb-1.5 flex items-center gap-1"
                             style={{ color: '#fbbf24' }}>
                            <span>⚠</span>
                            <span>
                              Enter values in <strong>{inferDisplayUnitSolver(sweepVar.name)}</strong> — same units as the solver script
                            </span>
                          </p>
                        )}
                        <div className="grid grid-cols-3 gap-1.5">
                          {[['min','Min','0'],['max','Max','1'],['steps','Steps','10']].map(([field, lbl, ph]) => (
                            <div key={field}>
                              <p className="text-[10px] mb-0.5" style={{ color: 'var(--tb-text-muted)' }}>
                                {lbl}
                                {field !== 'steps' && inferDisplayUnitSolver(sweepVar.name) && (
                                  <span className="ml-1 font-mono" style={{ color: 'var(--tb-accent)' }}>
                                    [{inferDisplayUnitSolver(sweepVar.name)}]
                                  </span>
                                )}
                              </p>
                              <input value={(sweepVar as any)[field]}
                                     onChange={e => updateVar({ [field]: e.target.value } as any)}
                                     placeholder={ph}
                                     className="w-full rounded-lg px-2 py-1.5 text-xs focus:outline-none"
                                     style={{ background: 'var(--tb-bg-base)', border: '1px solid var(--tb-border)',
                                              color: 'var(--tb-text-primary)' }} />
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div>
                        {inferDisplayUnitSolver(sweepVar.name) && (
                          <p className="text-[10px] mb-1.5 flex items-center gap-1"
                             style={{ color: '#fbbf24' }}>
                            <span>⚠</span>
                            <span>
                              Enter values in <strong>{inferDisplayUnitSolver(sweepVar.name)}</strong> — same units as the solver script
                            </span>
                          </p>
                        )}
                        <p className="text-[10px] mb-0.5" style={{ color: 'var(--tb-text-muted)' }}>
                          Values (comma-separated)
                          {inferDisplayUnitSolver(sweepVar.name) && (
                            <span className="ml-1 font-mono" style={{ color: 'var(--tb-accent)' }}>
                              [{inferDisplayUnitSolver(sweepVar.name)}]
                            </span>
                          )}
                        </p>
                        <input value={sweepVar.values}
                               onChange={e => updateVar({ values: e.target.value })}
                               placeholder="1e6, 2e6, 3e6"
                               className="w-full rounded-lg px-2 py-1.5 text-xs focus:outline-none font-mono"
                               style={{ background: 'var(--tb-bg-base)', border: '1px solid var(--tb-border)',
                                        color: 'var(--tb-text-primary)' }} />
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Output */}
          <SectionHeader title="Output" icon={<BarChart3 className="w-3.5 h-3.5"/>} />
          <div className="px-4 py-3">
            <p className="text-xs mb-2" style={{ color: 'var(--tb-text-muted)' }}>
              Leave blank to auto-detect all numeric outputs
            </p>

            {/* Dropdown with checkboxes */}
            <div ref={outputRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setOutputOpen(o => !o)}
                className="w-full flex items-center justify-between rounded-lg px-3 py-2 text-xs"
                style={{ background: 'var(--tb-bg-elevated)', border: '1px solid var(--tb-border)',
                         color: selectedOutputs.length ? 'var(--tb-text-primary)' : 'var(--tb-text-muted)',
                         cursor: 'pointer' }}>
                <span className="truncate">
                  {selectedOutputs.length === 0
                    ? 'Auto-detect all outputs'
                    : selectedOutputs.join(', ')}
                </span>
                <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 ml-2"
                             style={{ transform: outputOpen ? 'rotate(180deg)' : undefined,
                                      transition: 'transform 150ms' }} />
              </button>

              <AnimatePresence>
                {outputOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.12 }}
                    style={{
                      position: 'absolute', top: 'calc(100% + 4px)', width: '100%',
                      zIndex: 30, borderRadius: 10, overflow: 'hidden',
                      background: 'var(--tb-bg-surface)', border: '1px solid var(--tb-border)',
                      boxShadow: '0 8px 24px rgba(0,0,0,.28)',
                    }}>
                    {availableOutputs.length === 0 ? (
                      <p className="px-3 py-3 text-xs text-center" style={{ color: 'var(--tb-text-muted)' }}>
                        Run the solver first to see available outputs
                      </p>
                    ) : (
                      <>
                        {/* Clear / Select All row */}
                        <div className="flex items-center justify-between px-3 py-1.5"
                             style={{ borderBottom: '1px solid var(--tb-border-soft)' }}>
                          <span className="text-[10px] uppercase tracking-wider"
                                style={{ color: 'var(--tb-text-muted)' }}>
                            {selectedOutputs.length} selected
                          </span>
                          <button onClick={clearOutputs}
                                  className="text-[10px]" style={{ color: 'var(--tb-accent)', cursor: 'pointer',
                                                                    background: 'none', border: 'none' }}>
                            Clear
                          </button>
                        </div>
                        <ul style={{ maxHeight: 200, overflowY: 'auto', listStyle: 'none', margin: 0, padding: '4px 0' }}>
                          {availableOutputs.map(name => {
                            const checked = selectedOutputs.includes(name);
                            const unit    = inferDisplayUnitSolver(name);
                            return (
                              <li key={name}>
                                <button
                                  onClick={() => toggleOutput(name)}
                                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors"
                                  style={{ background: 'transparent', border: 'none', cursor: 'pointer',
                                           color: checked ? 'var(--tb-accent)' : 'var(--tb-text-secondary)' }}
                                  onMouseEnter={e => { if (!checked) (e.currentTarget as HTMLElement).style.background = 'var(--tb-bg-elevated)'; }}
                                  onMouseLeave={e => { if (!checked) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                                  {checked
                                    ? <CheckSquare className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--tb-accent)' }}/>
                                    : <Square      className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--tb-text-muted)' }}/>}
                                  <span className="font-mono flex-1">{name}</span>
                                  {unit && (
                                    <span className="text-[9px]" style={{ color: 'var(--tb-text-muted)' }}>{unit}</span>
                                  )}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Options */}
          <SectionHeader title="Options" icon={<Sliders className="w-3.5 h-3.5"/>} />
          <div className="px-4 py-3 space-y-2.5">
            <ToggleRow label="Generate plots"  checked={genPlots}   onChange={setGenPlots}   />
            <ToggleRow label="Save study to DB" checked={saveStudy} onChange={setSaveStudy}  />
          </div>

          {/* Run preview */}
          <div className="mx-4 mb-4 mt-2 p-3 rounded-xl"
               style={{ background: 'linear-gradient(135deg,rgba(14,165,233,.06),rgba(99,102,241,.06))',
                        border: '1px solid rgba(14,165,233,.15)' }}>
            <p className="text-xs font-semibold" style={{ color: 'var(--tb-text-secondary)' }}>Total cases</p>
            <p className="text-2xl font-bold mt-0.5"
               style={{ color: totalRuns > 200 ? '#f97316' : 'var(--tb-accent)',
                        fontFamily: 'Outfit,Inter,sans-serif' }}>
              {totalRuns.toLocaleString()}
            </p>
            {totalRuns > 200 && totalRuns <= 500 && (
              <p className="text-[10px] mt-1" style={{ color: '#fb923c' }}>⚡ Large sweep — may take a few seconds</p>
            )}
            {totalRuns > 500 && (
              <p className="text-[10px] mt-1" style={{ color: '#f87171' }}>✗ Exceeds 500-case limit — reduce steps</p>
            )}
          </div>
        </div>

        {/* ── Results panel ─────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <AnimatePresence mode="wait">
            {!result && !loading && (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                          className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
                <div className="p-5 rounded-2xl"
                     style={{ background: 'linear-gradient(135deg,rgba(14,165,233,.08),rgba(99,102,241,.08))',
                              border: '1px solid rgba(14,165,233,.12)' }}>
                  <BarChart3 className="w-16 h-16" style={{ color: 'var(--tb-accent)', opacity: 0.7 }} />
                </div>
                <div className="text-center">
                  <p className="text-base font-semibold mb-1" style={{ color: 'var(--tb-text-secondary)' }}>
                    Configure your sweep and hit Run
                  </p>
                  <p className="text-sm max-w-xs" style={{ color: 'var(--tb-text-muted)' }}>
                    ThermoBird will evaluate all variable combinations and return a full results matrix
                  </p>
                </div>
              </motion.div>
            )}

            {loading && (
              <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                          className="flex-1 flex flex-col items-center justify-center gap-5">
                <div className="relative w-20 h-20">
                  <div className="absolute inset-0 rounded-full border-4" style={{ borderColor: 'var(--tb-border)' }}/>
                  <div className="absolute inset-0 rounded-full border-4 animate-spin"
                       style={{ borderColor: 'transparent', borderTopColor: '#0ea5e9' }}/>
                  <Zap className="absolute inset-0 m-auto w-6 h-6" style={{ color: 'var(--tb-accent)' }}/>
                </div>
                <p className="font-semibold" style={{ color: 'var(--tb-text-primary)' }}>
                  Running {totalRuns} cases…
                </p>
              </motion.div>
            )}

            {result && !loading && (
              <motion.div key="results" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                          className="flex-1 flex flex-col overflow-hidden">
                {/* Results toolbar */}
                <div className="flex-shrink-0 flex items-center gap-3 px-5 py-2.5"
                     style={{ borderBottom: '1px solid var(--tb-border)', background: 'var(--tb-bg-surface)' }}>
                  <StatBadge label="Cases"   value={result.run_count}     color="#0ea5e9"/>
                  <StatBadge label="Success" value={result.success_count} color="#34d399"/>
                  {result.error_count > 0 &&
                    <StatBadge label="Errors" value={result.error_count}  color="#f87171"/>}
                  <StatBadge label="Time" value={`${result.execution_time_ms.toFixed(0)}ms`} color="#a78bfa"/>
                  <div className="flex-1"/>
                  <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: 'var(--tb-border)' }}>
                    {([
                      { id: 'table' as const, icon: <Table2  className="w-3.5 h-3.5"/>, label: 'Table',  disabled: false },
                      { id: 'chart' as const, icon: <BarChart3 className="w-3.5 h-3.5"/>, label: 'Charts',
                        disabled: !result.plot_data || result.plot_data.type === 'table_only' },
                    ]).map(btn => (
                      <button key={btn.id} disabled={btn.disabled} onClick={() => setActiveView(btn.id)}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors"
                              style={activeView === btn.id
                                ? { background: 'var(--tb-accent)', color: '#fff' }
                                : btn.disabled
                                  ? { background: 'var(--tb-bg-elevated)', color: 'var(--tb-text-muted)',
                                      cursor: 'not-allowed', opacity: 0.5 }
                                  : { background: 'var(--tb-bg-elevated)', color: 'var(--tb-text-muted)' }}>
                        {btn.icon} {btn.label}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setResult(null)} className="tb-btn-ghost flex items-center gap-1.5 text-xs">
                    <RefreshCw className="w-3 h-3"/> New Run
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-5">
                  <AnimatePresence mode="wait">
                    {activeView === 'table' && (
                      <motion.div key="t" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        <ResultsTable result={result} />
                      </motion.div>
                    )}
                    {activeView === 'chart' && result.plot_data && (
                      <motion.div key="c" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        <ResultsChart result={result} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Open Study Modal */}
      <AnimatePresence>
        {showOpenModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="fixed inset-0 z-50 flex items-center justify-center"
                      style={{ background: 'rgba(0,0,0,.65)' }}
                      onClick={() => setShowOpenModal(false)}>
            <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }}
                        exit={{ scale: 0.95 }} transition={{ duration: 0.18 }}
                        onClick={e => e.stopPropagation()}
                        className="rounded-2xl p-6 shadow-2xl"
                        style={{ background: 'var(--tb-bg-surface)', border: '1px solid var(--tb-border)',
                                 width: 540, maxHeight: '68vh', display: 'flex', flexDirection: 'column' }}>
              <div className="flex items-center justify-between mb-4">
                <p className="font-semibold" style={{ color: 'var(--tb-text-primary)' }}>
                  Saved Parametric Studies
                </p>
                <button onClick={() => setShowOpenModal(false)} style={{ color: 'var(--tb-text-muted)' }}>
                  <X className="w-4 h-4"/>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-2">
                {loadingStudies && (
                  <div className="flex justify-center py-8">
                    <svg className="animate-spin h-6 w-6" viewBox="0 0 24 24" fill="none"
                         style={{ color: 'var(--tb-accent)' }}>
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                  </div>
                )}
                {!loadingStudies && savedStudies.length === 0 && (
                  <p className="text-center py-8 text-sm" style={{ color: 'var(--tb-text-muted)' }}>
                    No saved studies yet
                  </p>
                )}
                {savedStudies.map(row => (
                  <div key={row.id}
                       className="flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-colors"
                       style={{ background: 'var(--tb-bg-elevated)', border: '1px solid var(--tb-border)' }}
                       onClick={() => loadStudy(row)}
                       onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--tb-accent)')}
                       onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--tb-border)')}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--tb-text-primary)' }}>
                        {row.name}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--tb-text-muted)' }}>
                        {row.variables_config.length} var · {row.run_count ?? '?'} cases ·{' '}
                        {row.source_type} · {new Date(row.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full"
                          style={{ background: row.status === 'completed'
                            ? 'rgba(52,211,153,.1)' : 'rgba(251,191,36,.1)',
                                   color: row.status === 'completed' ? '#34d399' : '#fbbf24' }}>
                      {row.status}
                    </span>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper components
// ─────────────────────────────────────────────────────────────────────────────

function SectionHeader({ title, icon, expanded, onToggle }: {
  title: string; icon: React.ReactNode; expanded?: boolean; onToggle?: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 cursor-pointer select-none"
         style={{ borderTop: '1px solid var(--tb-border)', borderBottom: '1px solid var(--tb-border)' }}
         onClick={onToggle}>
      <div className="flex items-center gap-2">
        <span style={{ color: 'var(--tb-accent)' }}>{icon}</span>
        <span className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: 'var(--tb-text-muted)' }}>{title}</span>
      </div>
      {onToggle !== undefined && (
        expanded
          ? <ChevronUp   className="w-3.5 h-3.5" style={{ color: 'var(--tb-text-muted)' }}/>
          : <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--tb-text-muted)' }}/>
      )}
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs" style={{ color: 'var(--tb-text-secondary)' }}>{label}</span>
      <button onClick={() => onChange(!checked)}
              className="relative w-9 h-5 rounded-full transition-colors flex-shrink-0"
              style={{ background: checked ? 'var(--tb-accent)' : 'var(--tb-bg-elevated)',
                       border: '1px solid var(--tb-border)' }}>
        <motion.div animate={{ x: checked ? 16 : 2 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    className="absolute top-0.5 w-3.5 h-3.5 rounded-full"
                    style={{ background: checked ? '#fff' : 'var(--tb-text-muted)' }}/>
      </button>
    </div>
  );
}

function StatBadge({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg"
         style={{ background: color + '11', border: `1px solid ${color}33` }}>
      <span className="text-xs font-medium" style={{ color }}>{value}</span>
      <span className="text-[10px]" style={{ color: 'var(--tb-text-muted)' }}>{label}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Transposed Results Table
// Variables as rows, sweep step cases as columns
// ─────────────────────────────────────────────────────────────────────────────
function ResultsTable({ result }: { result: ParametricRunResponse }) {
  const runCount  = result.run_count;
  const axisNames = result.axes.map(a => a.name);

  // Build per-run axis value objects
  const axisValueRows: Record<string, number | null>[] = [];
  for (let i = 0; i < runCount; i++) {
    const row: Record<string, number | null> = {};
    let rem = i;
    for (let ax = result.axes.length - 1; ax >= 0; ax--) {
      const len = result.axes[ax].values.length;
      row[result.axes[ax].name] = result.axes[ax].values[rem % len] ?? null;
      rem = Math.floor(rem / len);
    }
    axisValueRows.push(row);
  }

  const outputNames = Object.keys(result.outputs).sort((a, b) => a.localeCompare(b));
  const allVarNames = [
    ...axisNames.slice().sort((a, b) => a.localeCompare(b)),
    ...outputNames.filter(n => !axisNames.includes(n)),
  ];

  function getVal(varName: string, runIdx: number): number | null {
    if (axisNames.includes(varName)) return axisValueRows[runIdx]?.[varName] ?? null;
    return result.outputs[varName]?.[runIdx] ?? null;
  }

  const varStats: Record<string, { min: number; max: number }> = {};
  for (const name of outputNames) {
    const vals = (result.outputs[name] ?? []).filter((v): v is number => v !== null && isFinite(v));
    if (vals.length) varStats[name] = { min: Math.min(...vals), max: Math.max(...vals) };
  }

  const fmtCell = (varName: string, raw: number | null): { text: string; unit: string } => {
    if (raw === null || raw === undefined) return { text: '—', unit: '' };
    return fmtWithUnitSolver(varName, raw);
  };

  const stepLabel = (runIdx: number): string => {
    if (result.axes.length === 0) return `#${runIdx + 1}`;
    return result.axes.map(ax => {
      const raw = axisValueRows[runIdx]?.[ax.name] ?? null;
      if (raw === null) return ax.name;
      const { text, unit } = fmtWithUnitSolver(ax.name, raw);
      return unit ? `${text} ${unit}` : text;
    }).join(' · ');
  };

  return (
    <div>
      <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--tb-border)' }}>
        <div className="overflow-auto" style={{ maxHeight: 560 }}>
          <table className="text-xs" style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
              <tr style={{ background: 'var(--tb-bg-elevated)' }}>
                <th className="px-3 py-2.5 text-left font-semibold"
                    style={{ color: 'var(--tb-text-muted)', borderBottom: '1px solid var(--tb-border)',
                             borderRight: '1px solid var(--tb-border)', minWidth: 130,
                             position: 'sticky', left: 0, background: 'var(--tb-bg-elevated)', zIndex: 3 }}>
                  Variable
                </th>
                {Array.from({ length: runCount }, (_, i) => (
                  <th key={i} className="px-3 py-2.5 text-right font-medium"
                      style={{ color: '#7dd3fc', borderBottom: '1px solid var(--tb-border)',
                               whiteSpace: 'nowrap', minWidth: 110 }}>
                    <span className="text-[10px] font-normal block" style={{ color: 'var(--tb-text-muted)' }}>
                      Case {i + 1}
                    </span>
                    <span className="text-[10px]">{stepLabel(i)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allVarNames.map((varName, vi) => {
                const isAxis = axisNames.includes(varName);
                const stats  = varStats[varName];
                return (
                  <motion.tr key={varName}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(vi * 0.012, 0.3), duration: 0.12 }}
                    style={{ borderBottom: '1px solid var(--tb-border-soft)',
                             background: vi % 2 === 0 ? 'var(--tb-bg-surface)' : 'var(--tb-bg-base)' }}>
                    <td className="px-3 py-2 font-mono"
                        style={{ color: isAxis ? '#0ea5e9' : SERIES_COLORS[(vi - axisNames.length) % SERIES_COLORS.length],
                                 borderRight: '1px solid var(--tb-border)',
                                 position: 'sticky', left: 0, zIndex: 1,
                                 background: vi % 2 === 0 ? 'var(--tb-bg-surface)' : 'var(--tb-bg-base)',
                                 whiteSpace: 'nowrap' }}>
                      {varName}
                      {isAxis && (
                        <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded"
                              style={{ background: 'rgba(14,165,233,.12)', color: '#7dd3fc' }}>sweep</span>
                      )}
                    </td>
                    {Array.from({ length: runCount }, (_, runIdx) => {
                      const raw = getVal(varName, runIdx);
                      const { text, unit } = fmtCell(varName, raw);
                      const isMax = !isAxis && stats && raw !== null && raw === stats.max;
                      const isMin = !isAxis && stats && raw !== null && raw === stats.min;
                      return (
                        <td key={runIdx} className="px-3 py-2 text-right font-mono"
                            style={{ color: isMax ? '#34d399' : isMin ? '#f87171' : 'var(--tb-text-primary)',
                                     fontWeight: (isMax || isMin) ? 700 : 400 }}>
                          {text}
                          {unit && (
                            <span className="ml-1 text-[9px] font-normal" style={{ color: 'var(--tb-text-muted)' }}>
                              {unit}
                            </span>
                          )}
                          {isMax && <span className="ml-0.5 text-[9px]">▲</span>}
                          {isMin && <span className="ml-0.5 text-[9px]">▼</span>}
                        </td>
                      );
                    })}
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-center text-xs mt-3" style={{ color: 'var(--tb-text-muted)' }}>
        {result.success_count}/{result.run_count} cases · {result.execution_time_ms.toFixed(1)}ms
        {result.error_count > 0 &&
          <span style={{ color: '#f87171' }}> · {result.error_count} error{result.error_count > 1 ? 's' : ''}</span>}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Line Chart
// ─────────────────────────────────────────────────────────────────────────────
function ResultsChart({ result }: { result: ParametricRunResponse }) {
  const pd          = result.plot_data;
  const outputNames = Object.keys(result.outputs);

  if (!pd || pd.type === 'table_only') {
    return (
      <div className="flex items-center justify-center h-48 text-sm" style={{ color: 'var(--tb-text-muted)' }}>
        Charts available for single-variable sweeps
      </div>
    );
  }

  if ((pd.type === 'line' || pd.type === 'scatter') && pd.series) {
    return (
      <div className="space-y-6">
        {outputNames.map((name, i) => (
          <motion.div key={name} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.07 }}
                      className="p-4 rounded-xl"
                      style={{ background: 'var(--tb-bg-surface)', border: '1px solid var(--tb-border)' }}>
            <p className="text-xs font-semibold mb-3" style={{ color: SERIES_COLORS[i % SERIES_COLORS.length] }}>
              {name}
              <span className="ml-1.5 text-[10px] font-normal" style={{ color: 'var(--tb-text-muted)' }}>
                [{inferDisplayUnitSolver(name)}]
              </span>
            </p>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart
                data={pd.series.map((pt: any) => ({
                  ...pt,
                  x:    pt.x,
                  [name]: pt[name],
                }))}
                margin={{ top: 4, right: 16, bottom: 16, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--tb-border)" strokeOpacity={0.5}/>
                <XAxis dataKey="x" tick={{ fontSize: 10, fill: 'var(--tb-text-muted)' }}
                       label={{ value: `${pd.xAxis?.label || pd.xAxis?.name} [${inferDisplayUnitSolver(pd.xAxis?.name ?? '')}]`,
                                position: 'insideBottom', offset: -8, fontSize: 10, fill: 'var(--tb-text-muted)' }}/>
                <YAxis tick={{ fontSize: 10, fill: 'var(--tb-text-muted)' }} width={64}/>
                <Tooltip contentStyle={{ background: 'var(--tb-bg-elevated)', border: '1px solid var(--tb-border)',
                                         borderRadius: 8, fontSize: 11 }}
                         labelStyle={{ color: 'var(--tb-text-muted)' }}/>
                <Line type="monotone" dataKey={name} dot={{ r: 3 }} activeDot={{ r: 5 }}
                      stroke={SERIES_COLORS[i % SERIES_COLORS.length]} strokeWidth={2}/>
              </LineChart>
            </ResponsiveContainer>
          </motion.div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-48 text-sm" style={{ color: 'var(--tb-text-muted)' }}>
      No chart data for this sweep configuration
    </div>
  );
}
