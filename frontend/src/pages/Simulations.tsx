import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Trash2, Play, FlaskConical, Clock,
  AlertTriangle, Terminal, BarChart2,
} from 'lucide-react';
import {
  listSimulations, deleteSimulation, loadSimulationCanvas,
  listSolverScripts, deleteSolverScript, type SolverScriptRow,
} from '../lib/api';
import { useCycleStore } from '../store/cycleStore';
import type { CanvasComponent, CanvasConnection } from '../store/cycleStore';

interface SimulationRow {
  id: number;
  name: string;
  cycle_type: string;
  status: string;
  created_at: string;
  updated_at: string;
  description?: string;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function cycleTypeLabel(ct: string) {
  const map: Record<string, string> = {
    rankine:           'Rankine',
    orc:               'ORC',
    brayton:           'Brayton',
    vapor_compression: 'Vapor Compression',
    vapor_absorption:  'Vapor Absorption',
    custom:            'Custom',
  };
  return map[ct] ?? ct;
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { color: string; bg: string }> = {
    completed: { color: '#34d399', bg: 'rgba(52,211,153,0.1)' },
    draft:     { color: 'var(--tb-text-muted)', bg: 'var(--tb-bg-elevated)' },
    failed:    { color: '#f87171', bg: 'rgba(248,113,113,0.1)' },
    running:   { color: '#fbbf24', bg: 'rgba(251,191,36,0.1)' },
  };
  const { color, bg } = cfg[status] ?? cfg.draft;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 8px', borderRadius: 0, fontSize: 11, fontWeight: 600,
      color, background: bg, border: `1px solid ${color}33`,
    }}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export default function Simulations() {
  const navigate        = useNavigate();
  const loadFromDB      = useCycleStore(s => s.loadFromDB);
  const setSolverResults = useCycleStore(s => s.setSolverResults);
  const solverResults   = useCycleStore(s => s.solverResults);
  const canvasResults   = useCycleStore(s => s.canvasResults);
  const simulationName  = useCycleStore(s => s.simulationName);

  // Canvas simulations (DB)
  const [sims,       setSims]       = useState<SimulationRow[]>([]);
  const [simsLoading, setSimsLoading] = useState(true);
  const [deletingId,  setDeletingId]  = useState<number | null>(null);
  const [loadingId,   setLoadingId]   = useState<number | null>(null);

  // Solver scripts (DB)
  const [scripts,        setScripts]        = useState<SolverScriptRow[]>([]);
  const [scriptsLoading, setScriptsLoading] = useState(true);
  const [deletingScriptId, setDeletingScriptId] = useState<number | null>(null);

  const [error, setError] = useState<string | null>(null);

  // Load both lists on mount
  useEffect(() => {
    listSimulations()
      .then(setSims)
      .catch(() => setError('Could not load canvas simulations.'))
      .finally(() => setSimsLoading(false));

    listSolverScripts()
      .then(setScripts)
      .catch(() => {/* non-fatal — backend might not have table yet */})
      .finally(() => setScriptsLoading(false));
  }, []);

  // ── Canvas simulation handlers ─────────────────────────────────────────────

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this simulation? This cannot be undone.')) return;
    setDeletingId(id);
    try {
      await deleteSimulation(id);
      setSims(s => s.filter(r => r.id !== id));
    } catch {
      setError('Failed to delete simulation.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleLoad = async (sim: SimulationRow) => {
    setLoadingId(sim.id);
    try {
      const detail = await loadSimulationCanvas(sim.id);

      let fluid = 'Water';
      try {
        const desc = JSON.parse(detail.description ?? '{}');
        if (desc.fluid) fluid = desc.fluid;
      } catch { /* ignore */ }

      const components: CanvasComponent[] = (detail.components ?? []).map((c: any) => ({
        id:         String(c.id),
        type:       c.component_type,
        name:       c.component_name,
        position:   { x: c.position_x, y: c.position_y },
        parameters: c.parameters ?? {},
      }));

      const idMap: Record<number, string> = {};
      detail.components?.forEach((c: any, i: number) => { idMap[c.id] = components[i].id; });

      const connections: CanvasConnection[] = (detail.connections ?? [])
        .filter((cn: any) => idMap[cn.from_component_id] && idMap[cn.to_component_id])
        .map((cn: any) => ({
          id:       `loaded_${cn.id}`,
          from:     idMap[cn.from_component_id],
          to:       idMap[cn.to_component_id],
          fromPort: cn.from_port,
          toPort:   cn.to_port,
          fluid:    cn.fluid_name ?? fluid,
        }));

      loadFromDB({ id: sim.id, name: sim.name, fluid, components, connections });
      // Navigate to Canvas tab
      navigate('/dashboard', { state: { tab: 'canvas' } });
    } catch {
      setError(`Failed to load "${sim.name}".`);
    } finally {
      setLoadingId(null);
    }
  };

  // ── Solver script handlers ─────────────────────────────────────────────────

  const handleDeleteScript = async (id: number) => {
    if (!confirm('Delete this solver script? This cannot be undone.')) return;
    setDeletingScriptId(id);
    try {
      await deleteSolverScript(id);
      setScripts(s => s.filter(r => r.id !== id));
    } catch {
      setError('Failed to delete solver script.');
    } finally {
      setDeletingScriptId(null);
    }
  };

  const handleLoadScript = (row: SolverScriptRow) => {
    if (row.result_json) setSolverResults(row.result_json);
    // Navigate to Equation Solver tab with the script pre-loaded
    navigate('/dashboard', { state: { tab: 'solver', script: row.script } });
  };

  return (
    <div className="min-h-screen dashboard-root" style={{ background: 'var(--tb-bg-base)', color: 'var(--tb-text-primary)' }}>

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header className="tb-header flex items-center justify-between px-6 py-4">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm tb-btn-ghost">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <h1 className="text-base font-semibold" style={{ fontFamily: 'Outfit, Inter, sans-serif' }}>
          My Simulations
        </h1>
        <div style={{ width: 72 }} />
      </header>

      <div className="max-w-4xl mx-auto px-6 py-10">

        {/* ── Error banner ─────────────────────────────────────────────── */}
        {error && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-lg mb-6 text-sm"
               style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', color: '#fca5a5' }}>
            <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: '#f87171' }} />
            {error}
            <button onClick={() => setError(null)} className="ml-auto" style={{ color: '#f87171' }}>
              <span style={{ fontSize: 16 }}>×</span>
            </button>
          </div>
        )}

        {/* ── Current session results ──────────────────────────────────── */}
        {(canvasResults || solverResults) && (
          <div className="mb-8">
            <h2 className="text-sm font-semibold mb-3"
                style={{ color: 'var(--tb-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Current Session Results
            </h2>
            <div className="tb-card overflow-hidden">
              {canvasResults && (
                <div className="flex items-center gap-4 px-5 py-4"
                     style={{ borderBottom: solverResults ? '1px solid var(--tb-border-soft)' : 'none' }}
                     onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--tb-bg-elevated)'; }}
                     onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                  <div className="p-2 rounded-lg"
                       style={{ background: 'rgba(14,165,233,0.12)', border: '1px solid rgba(14,165,233,0.25)' }}>
                    <BarChart2 className="w-4 h-4" style={{ color: '#38bdf8' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium" style={{ color: 'var(--tb-text-primary)' }}>
                      {simulationName || 'Canvas Simulation'} — Results
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--tb-text-muted)' }}>
                      Canvas simulation · {canvasResults.success ? '✓ Completed' : '✗ Failed'}
                    </p>
                  </div>
                  <button className="tb-btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5"
                          onClick={() => navigate('/dashboard', { state: { tab: 'results' } })}>
                    <BarChart2 className="w-3 h-3" /> View Results
                  </button>
                </div>
              )}
              {solverResults && (
                <div className="flex items-center gap-4 px-5 py-4"
                     onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--tb-bg-elevated)'; }}
                     onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                  <div className="p-2 rounded-lg"
                       style={{ background: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.25)' }}>
                    <Terminal className="w-4 h-4" style={{ color: '#a78bfa' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium" style={{ color: 'var(--tb-text-primary)' }}>
                      {simulationName || 'Equation Solver'} — Script Results
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--tb-text-muted)' }}>
                      Equation solver · {Object.keys(solverResults.variables).length} variables · {solverResults.execution_time_ms.toFixed(1)} ms
                    </p>
                  </div>
                  <button className="tb-btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5"
                          onClick={() => navigate('/dashboard', { state: { tab: 'results' } })}>
                    <Terminal className="w-3 h-3" /> View Results
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Saved Solver Scripts ─────────────────────────────────────── */}
        <div className="mb-8">
          <h2 className="text-sm font-semibold mb-3"
              style={{ color: 'var(--tb-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Saved Solver Scripts
          </h2>

          {scriptsLoading && (
            <div className="space-y-3">
              {[1, 2].map(i => <div key={i} className="tb-card p-4 animate-pulse" style={{ height: 68 }} />)}
            </div>
          )}

          {!scriptsLoading && scripts.length === 0 && (
            <div className="tb-card flex items-center justify-center py-10 text-sm"
                 style={{ color: 'var(--tb-text-muted)' }}>
              No saved solver scripts yet. Use the global Save button while in the Equation Solver tab.
            </div>
          )}

          {!scriptsLoading && scripts.length > 0 && (
            <div className="tb-card overflow-hidden">
              {scripts.map((row, idx) => (
                <div
                  key={row.id}
                  className="flex items-center gap-4 px-5 py-4"
                  style={{
                    borderBottom: idx < scripts.length - 1 ? '1px solid var(--tb-border-soft)' : 'none',
                    transition: 'background 120ms',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--tb-bg-elevated)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <div className="p-2 rounded-lg flex-shrink-0"
                       style={{ background: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.25)' }}>
                    <Terminal className="w-4 h-4" style={{ color: '#a78bfa' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5 mb-1">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--tb-text-primary)' }}>
                        {row.name}
                      </p>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center',
                        padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                        color: row.success ? '#34d399' : '#f87171',
                        background: row.success ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)',
                        border: `1px solid ${row.success ? '#34d39933' : '#f8717133'}`,
                      }}>
                        {row.success ? 'Completed' : 'Failed'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--tb-text-muted)' }}>
                      <span>Equation solver</span>
                      {row.variable_count != null && <><span>·</span><span>{row.variable_count} variables</span></>}
                      {row.execution_time_ms != null && <><span>·</span><span>{row.execution_time_ms.toFixed(1)} ms</span></>}
                      <span>·</span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDate(row.created_at)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleLoadScript(row)}
                      className="flex items-center gap-1.5 tb-btn-primary text-xs px-3 py-1.5">
                      <Play className="w-3 h-3" /> Load
                    </button>
                    <button
                      onClick={() => handleDeleteScript(row.id)}
                      disabled={deletingScriptId === row.id}
                      className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors"
                      style={{ color: 'var(--tb-text-muted)', background: 'transparent', border: '1px solid var(--tb-border)' }}
                      onMouseEnter={e => { e.currentTarget.style.color = '#f87171'; e.currentTarget.style.borderColor = 'rgba(248,113,113,0.4)'; }}
                      onMouseLeave={e => { e.currentTarget.style.color = 'var(--tb-text-muted)'; e.currentTarget.style.borderColor = 'var(--tb-border)'; }}>
                      {deletingScriptId === row.id
                        ? <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                          </svg>
                        : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Saved Canvas Simulations ─────────────────────────────────── */}
        <h2 className="text-sm font-semibold mb-3"
            style={{ color: 'var(--tb-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Saved Canvas Simulations
        </h2>

        {simsLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="tb-card p-4 animate-pulse" style={{ height: 72 }} />)}
          </div>
        )}

        {!simsLoading && sims.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <FlaskConical className="w-12 h-12" style={{ color: 'var(--tb-text-muted)' }} />
            <p className="font-medium" style={{ color: 'var(--tb-text-secondary)' }}>No saved canvas simulations yet</p>
            <p className="text-sm" style={{ color: 'var(--tb-text-muted)' }}>
              Build a cycle on the Canvas tab and hit Save.
            </p>
            <button onClick={() => navigate('/dashboard', { state: { tab: 'canvas' } })} className="tb-btn-primary mt-2">
              Go to Canvas
            </button>
          </div>
        )}

        {!simsLoading && sims.length > 0 && (
          <div className="tb-card overflow-hidden">
            {sims.map((sim, idx) => (
              <div
                key={sim.id}
                className="flex items-center gap-4 px-5 py-4"
                style={{
                  borderBottom: idx < sims.length - 1 ? '1px solid var(--tb-border-soft)' : 'none',
                  transition: 'background 120ms',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--tb-bg-elevated)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2.5 mb-1">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--tb-text-primary)' }}>
                      {sim.name}
                    </p>
                    <StatusBadge status={sim.status} />
                  </div>
                  <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--tb-text-muted)' }}>
                    <span>{cycleTypeLabel(sim.cycle_type)}</span>
                    <span>·</span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDate(sim.updated_at)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleLoad(sim)}
                    disabled={loadingId === sim.id}
                    className="flex items-center gap-1.5 tb-btn-primary text-xs px-3 py-1.5">
                    {loadingId === sim.id
                      ? <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                        </svg>
                      : <Play className="w-3 h-3" />}
                    Load
                  </button>
                  <button
                    onClick={() => handleDelete(sim.id)}
                    disabled={deletingId === sim.id}
                    className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors"
                    style={{ color: 'var(--tb-text-muted)', background: 'transparent', border: '1px solid var(--tb-border)' }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#f87171'; e.currentTarget.style.borderColor = 'rgba(248,113,113,0.4)'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--tb-text-muted)'; e.currentTarget.style.borderColor = 'var(--tb-border)'; }}>
                    {deletingId === sim.id
                      ? <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                        </svg>
                      : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
