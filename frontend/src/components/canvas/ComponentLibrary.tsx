import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Cpu, LayoutTemplate, Zap } from 'lucide-react';
import { componentLibrary } from '../../lib/componentLibrary';
import { ALL_TEMPLATES, type CycleTemplate } from '../../lib/canvasTemplates';
import { useCycleStore } from '../../store/cycleStore';

type SideTab = 'components' | 'templates';

export default function ComponentLibrary() {
  const [activeTab, setActiveTab] = useState<SideTab>('components');

  const handleDragStart = (e: React.DragEvent, componentType: string) => {
    e.dataTransfer.setData('componentType', componentType);
  };

  const categories = [
    { name: 'Work Devices',  types: ['pump', 'turbine', 'compressor'] },
    { name: 'Heat Transfer', types: ['boiler', 'condenser', 'evaporator', 'heat_exchanger', 'regenerator'] },
    { name: 'Flow Control',  types: ['expansion_valve'] },
  ];

  return (
    <div className="w-60 flex-shrink-0 tb-sidebar border-r flex flex-col" style={{ overflow: 'hidden' }}>

      {/* ── Inner tab switcher ─────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex border-b" style={{ borderColor: 'var(--tb-border)' }}>
        {([
          { id: 'components' as SideTab, label: 'Components', icon: <Cpu className="w-3 h-3" /> },
          { id: 'templates'  as SideTab, label: 'Templates',  icon: <LayoutTemplate className="w-3 h-3" /> },
        ]).map(t => {
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className="relative flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors"
              style={{
                color: active ? 'var(--tb-accent)' : 'var(--tb-text-muted)',
                background: 'transparent', border: 'none', cursor: 'pointer',
              }}
            >
              {t.icon}
              {t.label}
              {active && (
                <motion.div
                  layoutId="sidebar-tab-indicator"
                  style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0, height: 2,
                    background: 'linear-gradient(90deg, var(--tb-accent), #818cf8)',
                    borderRadius: '2px 2px 0 0',
                  }}
                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Tab content ────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait" initial={false}>

          {/* COMPONENTS TAB */}
          {activeTab === 'components' && (
            <motion.div
              key="components"
              initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.15 }}
              className="px-3 py-4 space-y-5"
            >
              {categories.map((cat) => (
                <div key={cat.name}>
                  <p className="text-[10px] font-semibold uppercase tracking-widest px-1 mb-2"
                     style={{ color: 'var(--tb-text-muted)' }}>
                    {cat.name}
                  </p>
                  <div className="space-y-1.5">
                    {cat.types.map((type) => {
                      const comp = componentLibrary[type as keyof typeof componentLibrary];
                      return (
                        <div
                          key={type}
                          draggable
                          onDragStart={(e) => handleDragStart(e, type)}
                          className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-move border transition-colors"
                          style={{ background: 'var(--tb-bg-base)', borderColor: 'var(--tb-border)' }}
                          onMouseEnter={e => {
                            (e.currentTarget as HTMLElement).style.borderColor = 'var(--tb-accent)';
                            (e.currentTarget as HTMLElement).style.background  = 'var(--tb-accent-subtle)';
                          }}
                          onMouseLeave={e => {
                            (e.currentTarget as HTMLElement).style.borderColor = 'var(--tb-border)';
                            (e.currentTarget as HTMLElement).style.background  = 'var(--tb-bg-base)';
                          }}
                        >
                          <span className="text-xl leading-none">{comp.icon}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate" style={{ color: 'var(--tb-text-primary)' }}>
                              {comp.label}
                            </p>
                            <p className="text-[10px] truncate mt-0.5" style={{ color: 'var(--tb-text-muted)' }}>
                              {comp.description}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Tip */}
              <div className="mx-0 p-3 rounded-lg text-xs leading-relaxed"
                   style={{ background: 'var(--tb-accent-subtle)', border: '1px solid var(--tb-accent-border)', color: 'var(--tb-text-secondary)' }}>
                <strong style={{ color: 'var(--tb-accent)' }}>Tip:</strong> Drag components
                onto the canvas, then click to set parameters. Connect ports to build a cycle.
              </div>
            </motion.div>
          )}

          {/* TEMPLATES TAB */}
          {activeTab === 'templates' && (
            <motion.div
              key="templates"
              initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }} transition={{ duration: 0.15 }}
              className="px-3 py-4 space-y-3"
            >
              <p className="text-[10px] font-semibold uppercase tracking-widest px-1 mb-1"
                 style={{ color: 'var(--tb-text-muted)' }}>
                Pre-wired cycles
              </p>

              {ALL_TEMPLATES.map((tpl) => (
                <TemplateCard key={tpl.id} template={tpl} />
              ))}

              <div className="p-3 rounded-lg text-xs leading-relaxed mt-2"
                   style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.18)', color: 'var(--tb-text-secondary)' }}>
                <strong style={{ color: '#34d399' }}>Note:</strong> Loading a template
                replaces the current canvas. Save your work first.
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Template card
// ─────────────────────────────────────────────────────────────────────────────
function TemplateCard({ template: tpl }: { template: CycleTemplate }) {
  const [confirming, setConfirming] = useState(false);

  const loadTemplate = () => {
    const store = useCycleStore.getState();
    // loadFromDB resets canvas cleanly and sets fluid/components/connections
    store.loadFromDB({
      id:          0,
      name:        tpl.name,
      fluid:       tpl.fluid,
      components:  tpl.components.map(tc => ({
        id:         tc.id,
        type:       tc.type,
        name:       tc.type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        position:   { x: tc.x, y: tc.y },
        parameters: tc.params,
      })) as any,
      connections: tpl.connections.map(tc => ({
        id:       tc.id,
        from:     tc.fromId,
        fromPort: tc.fromPort,
        to:       tc.toId,
        toPort:   tc.toPort,
        fluid:    tpl.fluid,
      })) as any,
    });
    store.setMassFlowRate(tpl.massFlowRate);
    setConfirming(false);
  };

  const CYCLE_COLOR: Record<string, string> = {
    power:         '#f97316',   // orange
    refrigeration: '#38bdf8',   // sky
    heat_pump:     '#a78bfa',   // violet
  };
  const color = CYCLE_COLOR[tpl.cycleType] ?? 'var(--tb-accent)';

  return (
    <div className="rounded-xl border overflow-hidden"
         style={{ borderColor: confirming ? color : 'var(--tb-border)', background: 'var(--tb-bg-base)',
                  transition: 'border-color 150ms' }}>
      {/* Header */}
      <div className="flex items-start gap-2.5 px-3 pt-3 pb-2">
        <span className="text-2xl leading-none mt-0.5">{tpl.icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: 'var(--tb-text-primary)' }}>
            {tpl.name}
          </p>
          <p className="text-[10px] mt-0.5 leading-snug" style={{ color: 'var(--tb-text-muted)' }}>
            {tpl.description}
          </p>
        </div>
      </div>

      {/* Meta */}
      <div className="flex items-center gap-2 px-3 pb-2 flex-wrap">
        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ background: color + '18', color, border: `1px solid ${color}33` }}>
          {tpl.cycleType}
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full"
              style={{ background: 'var(--tb-bg-elevated)', color: 'var(--tb-text-muted)', border: '1px solid var(--tb-border)' }}>
          {tpl.fluid}
        </span>
        <span className="text-[10px]" style={{ color: 'var(--tb-text-muted)' }}>
          {tpl.components.length} components
        </span>
      </div>

      {/* Notes */}
      <div className="px-3 pb-2">
        <p className="text-[10px] leading-snug" style={{ color: 'var(--tb-text-muted)' }}>
          {tpl.notes}
        </p>
      </div>

      {/* Action */}
      <div className="px-3 pb-3">
        <AnimatePresence mode="wait" initial={false}>
          {!confirming ? (
            <motion.button
              key="load"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setConfirming(true)}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-colors"
              style={{ background: color + '18', color, border: `1px solid ${color}33`, cursor: 'pointer' }}
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
            >
              <Zap className="w-3 h-3" /> Load Template
            </motion.button>
          ) : (
            <motion.div
              key="confirm"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex gap-1.5"
            >
              <button
                onClick={() => setConfirming(false)}
                className="flex-1 py-1.5 rounded-lg text-xs"
                style={{ background: 'var(--tb-bg-elevated)', color: 'var(--tb-text-muted)',
                         border: '1px solid var(--tb-border)', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={loadTemplate}
                className="flex-1 py-1.5 rounded-lg text-xs font-semibold"
                style={{ background: color, color: '#fff', border: 'none', cursor: 'pointer' }}
              >
                Replace & Load
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
