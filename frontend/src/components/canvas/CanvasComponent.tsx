import { useState, useRef, useEffect, useCallback } from 'react';
import type { CanvasComponent as Component } from '../../store/cycleStore';
import { componentLibrary } from '../../lib/componentLibrary';
import type { ValidationIssue } from '../../lib/validateCanvas';
import { X } from 'lucide-react';

interface Props {
  component: Component;
  isSelected: boolean;
  onClick: () => void;
  onMove: (position: { x: number; y: number }) => void;
  onStartConnection: (port: string) => void;
  onCompleteConnection: (port: string) => void;
  isConnecting: boolean;
  canvasRef: React.RefObject<HTMLDivElement>;
  stateNumbers: Record<string, number>;
  hasError?: boolean;
  issues?: ValidationIssue[];
}

export default function CanvasComponent({
  component, isSelected, onClick, onMove,
  onStartConnection, onCompleteConnection, isConnecting, canvasRef,
  stateNumbers, hasError = false, issues = [],
}: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const [tooltipDismissed, setTooltipDismissed] = useState(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const ref = useRef<HTMLDivElement>(null);

  const config = componentLibrary[component.type];

  // Re-show tooltip whenever issues change (new errors after topology edit)
  const prevIssuesSig = useRef('');
  useEffect(() => {
    const sig = issues.map(i => i.message).join('|');
    if (sig !== prevIssuesSig.current) {
      prevIssuesSig.current = sig;
      setTooltipDismissed(false);
    }
  }, [issues]);

  // ── Drag ──────────────────────────────────────────────────────────────────
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!canvasRef.current) return;
    const r = canvasRef.current.getBoundingClientRect();
    onMove({
      x: e.clientX - r.left - dragOffsetRef.current.x,
      y: e.clientY - r.top  - dragOffsetRef.current.y,
    });
  }, [canvasRef, onMove]);

  const handleMouseUp = useCallback(() => setIsDragging(false), []);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup',   handleMouseUp);
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup',   handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const handleCardMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).dataset.port) return;
    e.preventDefault();
    if (ref.current && canvasRef.current) {
      const compRect = ref.current.getBoundingClientRect();
      dragOffsetRef.current = { x: e.clientX - compRect.left, y: e.clientY - compRect.top };
      setIsDragging(true);
      onClick();
    }
  };

  // ── Ports ──────────────────────────────────────────────────────────────────
  const handlePortMouseDown = (e: React.MouseEvent) => { e.stopPropagation(); e.preventDefault(); };
  const handlePortClick = (e: React.MouseEvent, port: string) => {
    e.stopPropagation(); e.preventDefault();
    if (isConnecting) onCompleteConnection(port);
    else { onClick(); onStartConnection(port); }
  };

  const PORT_COLORS: Record<string, string> = {
    inlet:        '#38bdf8',
    outlet:       '#f97316',
    hot_inlet:    '#fbbf24',
    hot_outlet:   '#ef4444',
    cold_inlet:   '#22d3ee',
    cold_outlet:  '#6366f1',
    inlet_1:      '#38bdf8',
    inlet_2:      '#a78bfa',
  };

  const Port = ({ port, style }: { port: string; style: React.CSSProperties }) => {
    if (!config?.ports?.includes(port)) return null;
    return (
      <div
        data-port={port}
        title={port.replace(/_/g, ' ')}
        onMouseDown={handlePortMouseDown}
        onClick={e => handlePortClick(e, port)}
        style={{
          position: 'absolute', width: 16, height: 16, borderRadius: '50%',
          background: PORT_COLORS[port] ?? '#94a3b8',
          border: '2px solid var(--tb-bg-base)',
          cursor: isConnecting ? 'crosshair' : 'pointer',
          zIndex: 30, pointerEvents: 'all',
          outline: isConnecting ? '2px solid rgba(56,189,248,0.55)' : 'none',
          outlineOffset: '2px',
          transition: 'transform 120ms',
          ...style,
        }}
        onMouseEnter={e => (e.currentTarget.style.transform = (style.transform ?? '') + ' scale(1.3)')}
        onMouseLeave={e => (e.currentTarget.style.transform = style.transform ?? '')}
      />
    );
  };

  // Show tooltip when: selected AND has issues AND not dismissed
  const showTooltip = isSelected && issues.length > 0 && !tooltipDismissed;

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        left: component.position.x,
        top:  component.position.y,
        zIndex: isSelected ? 10 : 1,
        userSelect: 'none',
        cursor: isDragging ? 'grabbing' : 'grab',
      }}
      onMouseDown={handleCardMouseDown}
    >
      {/* ── Card ── */}
      <div
        style={{
          width: 140, minHeight: 84,
          background: 'var(--tb-bg-surface)',
          border: `2px solid ${
            isSelected ? 'var(--tb-accent)' : hasError ? '#ef4444' : 'var(--tb-border)'
          }`,
          borderRadius: 0,
          boxShadow: isSelected
            ? '0 0 0 3px var(--tb-accent-subtle), var(--tb-panel-inset)'
            : hasError
              ? '0 0 0 3px rgba(239,68,68,0.18), var(--tb-panel-inset)'
              : 'var(--tb-panel-inset), 0 2px 8px rgba(0,0,0,0.25)',
          transition: 'border-color 150ms, box-shadow 150ms',
          position: 'relative',
        }}
      >
        <div className="p-3 text-center">
          <div className="text-3xl mb-1">{config?.icon}</div>
          <p className="text-xs font-medium truncate" style={{ color: 'var(--tb-text-primary)' }}>
            {component.name}
          </p>
          <p className="text-[10px]" style={{ color: 'var(--tb-text-muted)' }}>
            {config?.label}
          </p>
        </div>

        {/* Port dots */}
        <Port port="inlet"  style={{ left:  -9, top: '50%', transform: 'translateY(-50%)' }} />
        <Port port="outlet" style={{ right: -9, top: '50%', transform: 'translateY(-50%)' }} />

        {component.type === 'heat_exchanger' && (<>
          <Port port="hot_inlet"   style={{ left:  -9, top: '30%', transform: 'translateY(-50%)' }} />
          <Port port="cold_inlet"  style={{ left:  -9, top: '70%', transform: 'translateY(-50%)' }} />
          <Port port="hot_outlet"  style={{ right: -9, top: '30%', transform: 'translateY(-50%)' }} />
          <Port port="cold_outlet" style={{ right: -9, top: '70%', transform: 'translateY(-50%)' }} />
        </>)}

        {component.type === 'regenerator' && (<>
          <Port port="hot_inlet"   style={{ left:  -9, top: '28%', transform: 'translateY(-50%)' }} />
          <Port port="cold_outlet" style={{ left:  -9, top: '72%', transform: 'translateY(-50%)' }} />
          <Port port="hot_outlet"  style={{ right: -9, top: '28%', transform: 'translateY(-50%)' }} />
          <Port port="cold_inlet"  style={{ right: -9, top: '72%', transform: 'translateY(-50%)' }} />
        </>)}

        {component.type === 'mixing_chamber' && (<>
          <Port port="inlet_1" style={{ left:  -9, top: '30%', transform: 'translateY(-50%)' }} />
          <Port port="inlet_2" style={{ left:  -9, top: '70%', transform: 'translateY(-50%)' }} />
          <Port port="outlet"  style={{ right: -9, top: '50%', transform: 'translateY(-50%)' }} />
        </>)}
      </div>

      {/* Error badge — only shown when not selected (clicking selects → shows tooltip instead) */}
      {hasError && !isSelected && (
        <div
          title="Click to see issues"
          style={{
            position: 'absolute', top: -8, right: -8,
            width: 18, height: 18, borderRadius: '50%',
            background: '#ef4444', border: '2px solid var(--tb-bg-base)',
            zIndex: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontWeight: 700, color: '#fff', cursor: 'help',
          }}
        >
          !
        </div>
      )}

      {/* Validation tooltip — shown when selected, dismissible */}
      {showTooltip && (
        <div
          className="tb-slide-down"
          style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 6,
            width: 240,
            background: 'var(--tb-bg-elevated)',
            border: '1px solid rgba(239,68,68,0.35)',
            borderRadius: 0,
            zIndex: 50,
            pointerEvents: 'all',
            boxShadow: 'var(--tb-panel-inset), 0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          {/* Tooltip header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '6px 10px 5px',
            borderBottom: '1px solid rgba(239,68,68,0.2)',
          }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#f87171' }}>
              {issues.length} issue{issues.length > 1 ? 's' : ''}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); setTooltipDismissed(true); }}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'rgba(248,113,113,0.6)', padding: '1px', lineHeight: 1,
              }}
              title="Dismiss"
            >
              <X size={11} />
            </button>
          </div>

          {/* Issue rows */}
          <div style={{ padding: '6px 0' }}>
            {issues.map((iss, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 6,
                padding: '4px 10px',
                borderBottom: i < issues.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
              }}>
                <span style={{
                  flexShrink: 0, marginTop: 1,
                  color: iss.severity === 'error' ? '#f87171' : '#fbbf24',
                }}>
                  {iss.severity === 'error' ? '✗' : '⚠'}
                </span>
                <span style={{ fontSize: 10.5, lineHeight: 1.45, color: iss.severity === 'error' ? '#fca5a5' : '#fde68a' }}>
                  {iss.message}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Calculated-state indicator */}
      {component.state && !hasError && (
        <div style={{
          position: 'absolute', top: -8, right: -8, width: 16, height: 16,
          borderRadius: '50%', background: '#34d399', border: '2px solid var(--tb-bg-base)', zIndex: 20,
        }} />
      )}
    </div>
  );
}
