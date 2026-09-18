import { useEffect, useState } from 'react';
import { getDiagrams, DiagramResponse } from '../../lib/api';
import { BarChart2, AlertCircle } from 'lucide-react';

interface Props { fluid: string; T: number; P: number; H: number; S: number; }
type Status = 'idle' | 'loading' | 'done' | 'error';

export default function DiagramPanel({ fluid, T, P, H, S }: Props) {
  const [status,   setStatus]   = useState<Status>('idle');
  const [diagrams, setDiagrams] = useState<DiagramResponse | null>(null);
  const [errMsg,   setErrMsg]   = useState('');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setDiagrams(null);
    setErrMsg('');

    getDiagrams({ fluid, T, P, H, S })
      .then(data => { if (!cancelled) { setDiagrams(data); setStatus('done'); } })
      .catch((err: any) => {
        if (!cancelled) {
          setErrMsg(err?.response?.data?.detail || err?.message || 'Diagram generation failed.');
          setStatus('error');
        }
      });

    return () => { cancelled = true; };
  }, [fluid, T, P, H, S]);

  return (
    <div className="mt-5">

      {/* Section header */}
      <div className="flex items-center gap-2 mb-3">
        <div className="p-1.5 rounded-lg"
             style={{ background: 'var(--tb-accent-subtle)', border: '1px solid var(--tb-accent-border)' }}>
          <BarChart2 className="w-4 h-4" style={{ color: 'var(--tb-accent)' }} />
        </div>
        <h3 className="text-sm font-semibold tracking-wide"
            style={{ color: 'var(--tb-text-primary)' }}>
          Thermodynamic Diagrams
        </h3>
        <span className="text-xs ml-1" style={{ color: 'var(--tb-text-muted)' }}>
          — state point on saturation dome
        </span>
      </div>

      {/* Loading skeleton */}
      {status === 'loading' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[0, 1].map(i => (
            <div key={i} className="rounded-xl overflow-hidden"
                 style={{ background: 'var(--tb-bg-surface)', border: '1px solid var(--tb-border)' }}>
              <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--tb-border-soft)' }}>
                <div className="h-3 w-28 rounded animate-pulse"
                     style={{ background: 'var(--tb-bg-elevated)' }} />
              </div>
              <div className="flex items-center justify-center h-[300px] gap-3">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none"
                     style={{ color: 'var(--tb-accent)' }}>
                  <circle className="opacity-25" cx="12" cy="12" r="10"
                          stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                <span className="text-sm" style={{ color: 'var(--tb-text-muted)' }}>
                  Generating diagram…
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {status === 'error' && (
        <div className="flex items-start gap-3 p-4 rounded-xl"
             style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#f87171' }} />
          <div>
            <p className="text-sm font-medium" style={{ color: '#f87171' }}>Diagram error</p>
            <p className="text-xs mt-0.5" style={{ color: 'rgba(248,113,113,0.7)' }}>{errMsg}</p>
          </div>
        </div>
      )}

      {/* Diagrams */}
      {status === 'done' && diagrams && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DiagramCard title="T-s Diagram"  subtitle="Temperature — Entropy"  src={diagrams.ts} />
          <DiagramCard title="P-h Diagram"  subtitle="Pressure — Enthalpy"    src={diagrams.ph} />
        </div>
      )}
    </div>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────
function DiagramCard({ title, subtitle, src }: { title: string; subtitle: string; src: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <div className="rounded-xl overflow-hidden transition-colors group"
           style={{ background: 'var(--tb-bg-surface)', border: '1px solid var(--tb-border)' }}
           onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--tb-accent)'}
           onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--tb-border)'}>

        {/* Card header */}
        <div className="flex items-center justify-between px-3 py-2"
             style={{ borderBottom: '1px solid var(--tb-border-soft)' }}>
          <div>
            <p className="text-xs font-semibold" style={{ color: 'var(--tb-text-primary)' }}>
              {title}
            </p>
            <p className="text-[10px]" style={{ color: 'var(--tb-text-muted)' }}>{subtitle}</p>
          </div>
          <button
            onClick={() => setExpanded(true)}
            title="Expand"
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-xs"
            style={{ background: 'var(--tb-bg-elevated)', color: 'var(--tb-text-secondary)' }}
          >
            ⤢
          </button>
        </div>

        {/* Chart — Matplotlib generates dark-bg PNGs; they look fine on both themes */}
        <img
          src={`data:image/png;base64,${src}`}
          alt={title}
          className="w-full block cursor-zoom-in"
          onClick={() => setExpanded(true)}
        />
      </div>

      {/* Lightbox */}
      {expanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(4px)' }}
          onClick={() => setExpanded(false)}
        >
          <div
            className="relative max-w-4xl w-full rounded-2xl overflow-hidden shadow-2xl"
            style={{ background: 'var(--tb-bg-surface)', border: '1px solid var(--tb-border)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3"
                 style={{ borderBottom: '1px solid var(--tb-border)' }}>
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--tb-text-primary)' }}>
                  {title}
                </p>
                <p className="text-xs" style={{ color: 'var(--tb-text-muted)' }}>{subtitle}</p>
              </div>
              <button
                onClick={() => setExpanded(false)}
                className="p-1.5 rounded-lg text-sm font-bold transition-colors"
                style={{ background: 'var(--tb-bg-elevated)', color: 'var(--tb-text-secondary)' }}
              >
                ✕
              </button>
            </div>
            <img src={`data:image/png;base64,${src}`} alt={title} className="w-full block" />
          </div>
        </div>
      )}
    </>
  );
}
