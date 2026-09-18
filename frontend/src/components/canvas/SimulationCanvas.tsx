import { useState, useRef, useEffect, useCallback } from 'react';
import { useCycleStore, computeStateNumbers } from '../../store/cycleStore';
import ComponentLibrary from './ComponentLibrary';
import CanvasComponent from './CanvasComponent';
import ConnectionLine from './ConnectionLine';
import PropertiesPanel from './PropertiesPanel';
import { validateCanvas, type ValidationIssue } from '../../lib/validateCanvas';
import { Undo2, Redo2, Trash2, X } from 'lucide-react';

const typeCounters: Record<string, number> = {};
const CARD_W = 140;
const CARD_H = 84;

function portPosition(
  pos: { x: number; y: number },
  port: string,
  componentType?: string,
): { x: number; y: number } {
  if (port === 'inlet')   return { x: pos.x,          y: pos.y + CARD_H * 0.5 };
  if (port === 'outlet')  return { x: pos.x + CARD_W,  y: pos.y + CARD_H * 0.5 };
  if (port === 'inlet_1') return { x: pos.x,          y: pos.y + CARD_H * 0.30 };
  if (port === 'inlet_2') return { x: pos.x,          y: pos.y + CARD_H * 0.70 };
  if (componentType === 'regenerator') {
    if (port === 'hot_inlet')   return { x: pos.x,          y: pos.y + CARD_H * 0.28 };
    if (port === 'cold_outlet') return { x: pos.x,          y: pos.y + CARD_H * 0.72 };
    if (port === 'hot_outlet')  return { x: pos.x + CARD_W,  y: pos.y + CARD_H * 0.28 };
    if (port === 'cold_inlet')  return { x: pos.x + CARD_W,  y: pos.y + CARD_H * 0.72 };
  }
  if (port === 'hot_inlet')   return { x: pos.x,          y: pos.y + CARD_H * 0.30 };
  if (port === 'cold_inlet')  return { x: pos.x,          y: pos.y + CARD_H * 0.70 };
  if (port === 'hot_outlet')  return { x: pos.x + CARD_W,  y: pos.y + CARD_H * 0.30 };
  if (port === 'cold_outlet') return { x: pos.x + CARD_W,  y: pos.y + CARD_H * 0.70 };
  return { x: pos.x + CARD_W / 2, y: pos.y + CARD_H / 2 };
}

export default function SimulationCanvas() {
  const [selectedComponentId, setSelectedComponentId]   = useState<string | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [connectingFrom, setConnectingFrom]             = useState<{ componentId: string; port: string } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Validation state — re-runs whenever topology changes
  const [validation, setValidation] = useState(() => validateCanvas([], []));
  // Whether the user has dismissed the bottom banner for the current error set.
  // Reset whenever the validation errors change (topology changed).
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const prevErrorSig = useRef('');

  const components      = useCycleStore((s) => s.components);
  const connections     = useCycleStore((s) => s.connections);
  const past            = useCycleStore((s) => s.past);
  const future          = useCycleStore((s) => s.future);
  const addComponent    = useCycleStore((s) => s.addComponent);
  const updateComponent = useCycleStore((s) => s.updateComponent);
  const deleteComponent = useCycleStore((s) => s.deleteComponent);
  const addConnection    = useCycleStore((s) => s.addConnection);
  const deleteConnection = useCycleStore((s) => s.deleteConnection);
  const undo             = useCycleStore((s) => s.undo);
  const redo             = useCycleStore((s) => s.redo);

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  // Keep validation fresh; auto-clear dismissed banner when errors change
  useEffect(() => {
    const result = validateCanvas(components, connections);

    // Strip issues whose componentId no longer exists on the canvas
    // (handles the "deleted component, stale warning" case)
    const existingIds = new Set(components.map(c => c.id));
    existingIds.add('__global__');
    const filtered: typeof result = {
      ...result,
      errors:   result.errors.filter(i => existingIds.has(i.componentId)),
      warnings: result.warnings.filter(i => existingIds.has(i.componentId)),
      all:      result.all.filter(i => existingIds.has(i.componentId)),
    };
    filtered.ok = filtered.errors.length === 0;
    setValidation(filtered);

    // Build a signature from the current error messages so we know if the set changed
    const sig = filtered.errors.map(e => `${e.componentId}:${e.message}`).sort().join('|');
    if (sig !== prevErrorSig.current) {
      prevErrorSig.current = sig;
      setBannerDismissed(false);   // new errors → show banner again
    }
  }, [components, connections]);

  // IDs that have at least one error
  const errorComponentIds = new Set(validation.errors.map(e => e.componentId));

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) {
        if ((e.key === 'Delete' || e.key === 'Backspace') && selectedConnectionId) {
          e.preventDefault();
          deleteConnection(selectedConnectionId);
          setSelectedConnectionId(null);
        }
        return;
      }
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, selectedConnectionId, deleteConnection]);

  // Canvas drop
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const componentType = e.dataTransfer.getData('componentType');
    if (!componentType || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    typeCounters[componentType] = (typeCounters[componentType] ?? 0) + 1;
    const displayType = componentType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const cleanName = `${displayType} ${typeCounters[componentType]}`;
    addComponent({
      type:       componentType as any,
      name:       cleanName,
      position:   { x: e.clientX - rect.left - CARD_W / 2, y: e.clientY - rect.top - CARD_H / 2 },
      parameters: {},
    });
  };

  const handleDragOver = (e: React.DragEvent) => e.preventDefault();

  // Connections
  const handleStartConnection    = (componentId: string, port: string) => setConnectingFrom({ componentId, port });
  const handleCompleteConnection = (toComponentId: string, toPort: string) => {
    if (!connectingFrom) return;
    if (connectingFrom.componentId === toComponentId) { setConnectingFrom(null); return; }
    addConnection({
      from: connectingFrom.componentId, to: toComponentId,
      fromPort: connectingFrom.port,    toPort,
      fluid: useCycleStore.getState().fluid,
    });
    setConnectingFrom(null);
  };

  const selectedComponent = selectedComponentId
    ? components.find(c => c.id === selectedComponentId) ?? null
    : null;

  const issuesByComponent = useCallback((id: string): ValidationIssue[] =>
    validation.all.filter(i => i.componentId === id)
  , [validation]);

  const stateNumbers = computeStateNumbers(components, connections);

  // Toolbar button style helper
  const tbBtn = (disabled: boolean) => ({
    opacity:    disabled ? 0.35 : 1,
    cursor:     disabled ? 'not-allowed' : 'pointer',
    color:      'var(--tb-text-secondary)',
    background: 'transparent',
    border:     'none',
    padding:    '6px',
    borderRadius: 0,
    display:    'flex',
    alignItems: 'center',
    gap:        '4px',
    fontSize:   '11px',
    transition: 'background 150ms',
  } as React.CSSProperties);

  const showBanner = validation.errors.length > 0 && !connectingFrom && !bannerDismissed;

  return (
    <div className="flex h-full">
      {/* Left sidebar */}
      <ComponentLibrary />

      {/* Canvas area */}
      <div className="flex-1 relative overflow-hidden" style={{ background: 'var(--tb-bg-base)' }}>
        <div
          ref={canvasRef}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          className="w-full h-full relative tb-canvas"
          onClick={() => { if (connectingFrom) setConnectingFrom(null); }}
        >
          {/* SVG connection lines */}
          <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }}>
            <defs>
              <marker id="tb-arrow" markerWidth="8" markerHeight="8"
                      refX="7" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="var(--tb-accent)" />
              </marker>
            </defs>
            {connections.map((conn) => {
              const fromComp = components.find(c => c.id === conn.from);
              const toComp   = components.find(c => c.id === conn.to);
              if (!fromComp || !toComp) return null;
              const isSelected = selectedConnectionId === conn.id;
              return (
                <ConnectionLine
                  key={conn.id}
                  from={portPosition(fromComp.position, conn.fromPort, fromComp.type)}
                  to={portPosition(toComp.position, conn.toPort, toComp.type)}
                  fromPort={conn.fromPort}
                  toPort={conn.toPort}
                  fluid={conn.fluid}
                  stateNum={stateNumbers[`${conn.from}:${conn.fromPort}`]}
                  isSelected={isSelected}
                  onSelect={() => {
                    setSelectedConnectionId(isSelected ? null : conn.id);
                    setSelectedComponentId(null);
                  }}
                />
              );
            })}
          </svg>

          {/* Component cards */}
          {components.map((component) => (
            <CanvasComponent
              key={component.id}
              component={component}
              isSelected={selectedComponentId === component.id}
              onClick={() => { setSelectedComponentId(component.id); setSelectedConnectionId(null); }}
              onMove={(pos) => updateComponent(component.id, { position: pos })}
              onStartConnection={(port) => handleStartConnection(component.id, port)}
              onCompleteConnection={(port) => handleCompleteConnection(component.id, port)}
              isConnecting={connectingFrom !== null && connectingFrom.componentId !== component.id}
              canvasRef={canvasRef}
              stateNumbers={stateNumbers}
              hasError={errorComponentIds.has(component.id)}
              issues={issuesByComponent(component.id)}
            />
          ))}

          {/* Empty-state hint */}
          {components.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center space-y-2">
                <div className="text-4xl opacity-20" style={{ filter: 'grayscale(0.5)' }}>⚙</div>
                <p className="text-sm font-medium" style={{ color: 'var(--tb-text-muted)' }}>
                  Drag components from the library
                </p>
                <p className="text-xs" style={{ color: 'var(--tb-text-muted)', opacity: 0.7 }}>
                  Click a port dot to start a connection, then click another port
                </p>
              </div>
            </div>
          )}

          {/* ── Validation error banner — dismissible ── */}
          {showBanner && (
            <div
              className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-start gap-2 px-4 py-2.5 rounded-lg text-xs font-medium max-w-lg tb-slide-down"
              style={{
                background: 'rgba(239,68,68,0.12)',
                border: '1px solid rgba(239,68,68,0.35)',
                color: '#fca5a5',
                backdropFilter: 'blur(6px)',
                pointerEvents: 'all',
              }}
            >
              <span className="flex-1">
                <span style={{ color: '#f87171', fontWeight: 700 }}>
                  ⚠ {validation.errors.length} issue{validation.errors.length > 1 ? 's' : ''} —{' '}
                </span>
                {validation.errors[0].message}
                {validation.errors.length > 1 && (
                  <span style={{ color: 'rgba(252,165,165,0.7)' }}> (+{validation.errors.length - 1} more)</span>
                )}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); setBannerDismissed(true); }}
                style={{
                  flexShrink: 0, background: 'transparent', border: 'none',
                  color: 'rgba(252,165,165,0.7)', cursor: 'pointer', padding: '0 2px',
                  lineHeight: 1,
                }}
                title="Dismiss"
              >
                <X size={13} />
              </button>
            </div>
          )}

          {/* Connecting-mode banner */}
          {connectingFrom && (
            <div
              className="absolute top-3 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-xs font-medium pointer-events-none"
              style={{ background: 'var(--tb-accent)', color: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }}
            >
              Click a port on another component to connect — or click canvas to cancel
            </div>
          )}
        </div>

        {/* ── Toolbar ── */}
        <div
          className="absolute top-3 right-3 flex items-center gap-1 p-1.5 rounded-lg border"
          style={{
            background: 'var(--tb-bg-surface)',
            borderColor: 'var(--tb-border)',
            boxShadow: 'var(--tb-panel-shadow)',
          }}
        >
          <button title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => undo()} style={tbBtn(!canUndo)}
            onMouseEnter={e => { if (canUndo) e.currentTarget.style.background = 'var(--tb-bg-elevated)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
            <Undo2 size={14} /><span>Undo</span>
          </button>

          <button title="Redo (Ctrl+Y)" disabled={!canRedo} onClick={() => redo()} style={tbBtn(!canRedo)}
            onMouseEnter={e => { if (canRedo) e.currentTarget.style.background = 'var(--tb-bg-elevated)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
            <Redo2 size={14} /><span>Redo</span>
          </button>

          <div style={{ width: 1, height: 20, background: 'var(--tb-border)', margin: '0 4px' }} />

          <button onClick={() => useCycleStore.getState().clearCanvas()} style={tbBtn(false)}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--tb-bg-elevated)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
            Clear
          </button>

          {selectedComponentId && (
            <button
              onClick={() => { deleteComponent(selectedComponentId); setSelectedComponentId(null); }}
              style={{ ...tbBtn(false), color: '#f87171' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
              Delete
            </button>
          )}

          {selectedConnectionId && (
            <button
              title="Delete connection (Del)"
              onClick={() => { deleteConnection(selectedConnectionId); setSelectedConnectionId(null); }}
              style={{ ...tbBtn(false), color: '#f87171' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
              <Trash2 size={13} /><span>Del Line</span>
            </button>
          )}
        </div>
      </div>

      {/* Right properties panel */}
      <PropertiesPanel
        component={selectedComponent}
        onUpdate={(updates) => selectedComponent && updateComponent(selectedComponent.id, updates)}
        onClose={() => setSelectedComponentId(null)}
      />
    </div>
  );
}
