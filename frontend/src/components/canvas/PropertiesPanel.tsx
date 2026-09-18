import { useState } from 'react';
import type { CanvasComponent as Component } from '../../store/cycleStore';
import { useCycleStore } from '../../store/cycleStore';
import { componentLibrary } from '../../lib/componentLibrary';
import { X, ChevronDown, ChevronUp } from 'lucide-react';

interface Props {
  component: Component | null;
  onUpdate: (updates: Partial<Component>) => void;
  onClose: () => void;
}

const FLUIDS: { group: string; options: { value: string; label: string }[] }[] = [
  { group: 'Water / Steam',   options: [{ value: 'Water',    label: 'Water (H₂O)' }] },
  { group: 'Refrigerants',    options: [
    { value: 'R134a',   label: 'R-134a' },
    { value: 'R410A',   label: 'R-410A' },
    { value: 'R32',     label: 'R-32' },
    { value: 'R22',     label: 'R-22' },
    { value: 'Ammonia', label: 'Ammonia (NH₃)' },
    { value: 'CO2',     label: 'CO₂ (R-744)' },
  ]},
  { group: 'ORC / Organics',  options: [
    { value: 'n-Butane',  label: 'n-Butane' },
    { value: 'IsoButane', label: 'Isobutane' },
    { value: 'Propane',   label: 'Propane' },
    { value: 'Ethane',    label: 'Ethane' },
  ]},
  { group: 'Gases (Brayton)', options: [
    { value: 'Air',      label: 'Air' },
    { value: 'Nitrogen', label: 'Nitrogen (N₂)' },
    { value: 'Helium',   label: 'Helium' },
  ]},
];

export default function PropertiesPanel({ component, onUpdate, onClose }: Props) {
  const [showState, setShowState] = useState(false);

  const fluid           = useCycleStore(s => s.fluid);
  const massFlowRate    = useCycleStore(s => s.massFlowRate);
  const deadStateT0     = useCycleStore(s => s.deadStateT0);
  const deadStateP0     = useCycleStore(s => s.deadStateP0);
  const setFluid        = useCycleStore(s => s.setFluid);
  const setMassFlowRate = useCycleStore(s => s.setMassFlowRate);

  const config = component ? componentLibrary[component.type] : null;

  const handleParam = (key: string, val: number) => {
    if (!component) return;
    onUpdate({ parameters: { ...component.parameters, [key]: val } });
  };

  return (
    <div className="w-72 flex-shrink-0 tb-sidebar border-l flex flex-col overflow-hidden"
         style={{ borderColor: 'var(--tb-border)' }}>

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b"
           style={{ borderColor: 'var(--tb-border)' }}>
        {component && config ? (
          <div className="flex items-center gap-2.5">
            <span className="text-2xl leading-none">{config.icon}</span>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--tb-text-primary)' }}>
                {component.name}
              </p>
              <p className="text-[10px]" style={{ color: 'var(--tb-text-muted)' }}>
                {config.label}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm font-semibold" style={{ color: 'var(--tb-text-primary)' }}>
            Canvas Settings
          </p>
        )}
        {component && (
          <button onClick={onClose}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: 'var(--tb-text-muted)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--tb-bg-elevated)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">

        {/* ════ GLOBAL — always visible ════ */}
        <Section title="Global">
          <Field label="Working Fluid">
            <select value={fluid} onChange={e => setFluid(e.target.value)}
              className="tb-input" style={{ appearance: 'auto' }}>
              {FLUIDS.map(g => (
                <optgroup key={g.group} label={g.group}>
                  {g.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </optgroup>
              ))}
            </select>
          </Field>

          <Field label="Mass Flow Rate" unit="kg/s">
            <input type="number" value={massFlowRate} min={0.001} step={0.1}
              onChange={e => setMassFlowRate(parseFloat(e.target.value))}
              className="tb-input font-mono" />
          </Field>

          <Field label="Dead-State Temperature T₀" unit="K">
            <input type="number" value={deadStateT0} min={200} step={1}
              onChange={e => useCycleStore.setState({ deadStateT0: parseFloat(e.target.value) })}
              className="tb-input font-mono" />
          </Field>

          <Field label="Dead-State Pressure P₀" unit="kPa">
            <input type="number" value={+(deadStateP0 / 1000).toFixed(4)} min={0.1} step={1}
              onChange={e => useCycleStore.setState({ deadStateP0: parseFloat(e.target.value) * 1000 })}
              className="tb-input font-mono" />
          </Field>
        </Section>

        {/* ════ COMPONENT — only when selected ════ */}
        {component && config ? (
          <>
            <div style={{ height: 1, background: 'var(--tb-border)' }} />

            {/* Name */}
            <Field label="Component Name">
              <input type="text" value={component.name}
                onChange={e => onUpdate({ name: e.target.value })}
                className="tb-input" />
            </Field>

            {/* Governing equation badge */}
            <div className="px-3 py-2 rounded-lg font-mono text-xs"
                 style={{ background: 'var(--tb-bg-elevated)', color: 'var(--tb-accent)', lineHeight: 1.6 }}>
              {config.equation}
            </div>

            {/* Property inputs from library */}
            {config.propertyInputs.length > 0 && (
              <Section title="Component Parameters">
                {config.propertyInputs.map(inp => (
                  <ParamField
                    key={inp.key}
                    label={inp.label}
                    unit={inp.unit}
                    hint={inp.hint}
                    value={component.parameters[inp.key] ?? config.defaultParams[inp.key] ?? ''}
                    onChange={v => handleParam(inp.key, v)}
                    step={inp.step}
                    min={inp.min}
                    max={inp.max}
                  />
                ))}
              </Section>
            )}

            {/* Inlet / Outlet state (post-simulation) */}
            {component.state && (
              <div>
                <button onClick={() => setShowState(s => !s)}
                  className="flex items-center justify-between w-full py-1"
                  style={{ color: 'var(--tb-text-secondary)' }}>
                  <span className="text-xs font-semibold uppercase tracking-wide">Inlet / Outlet State</span>
                  {showState ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
                {showState && (
                  <div className="space-y-2 text-sm mt-2">
                    {component.state.inlet  && <StateCard label="Inlet"  state={component.state.inlet}  accent="var(--tb-accent)" />}
                    {component.state.outlet && <StateCard label="Outlet" state={component.state.outlet} accent="#f97316" />}
                  </div>
                )}
              </div>
            )}

            {/* Component description */}
            <p className="text-[11px] leading-relaxed px-3 py-2 rounded-lg"
               style={{ background: 'var(--tb-bg-elevated)', color: 'var(--tb-text-muted)' }}>
              {config.description}
            </p>
          </>
        ) : (
          <p className="text-xs text-center py-4" style={{ color: 'var(--tb-text-muted)' }}>
            Click a component on the canvas to edit its parameters.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function Field({ label, unit, children }: { label: string; unit?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="flex items-center justify-between mb-1.5">
        <span className="tb-label">{label}</span>
        {unit && <span className="text-xs" style={{ color: 'var(--tb-text-muted)' }}>{unit}</span>}
      </label>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="tb-label mb-3">{title}</p>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function ParamField({ label, unit, hint, value, onChange, step, min, max }: {
  label: string; unit?: string; hint?: string;
  value: number | string; onChange: (v: number) => void;
  step?: number; min?: number; max?: number;
}) {
  return (
    <div>
      <label className="flex items-center justify-between mb-1">
        <span className="text-sm" style={{ color: 'var(--tb-text-secondary)' }}>{label}</span>
        {unit && <span className="text-xs" style={{ color: 'var(--tb-text-muted)' }}>{unit}</span>}
      </label>
      <input type="number" value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        step={step ?? 'any'} min={min} max={max}
        className="tb-input font-mono" />
      {hint && <p className="text-[10px] mt-0.5" style={{ color: 'var(--tb-text-muted)' }}>{hint}</p>}
    </div>
  );
}

function StateCard({ label, state, accent }: { label: string; state: any; accent: string }) {
  return (
    <div className="p-3 rounded-lg border"
         style={{ background: 'var(--tb-bg-base)', borderColor: accent + '44' }}>
      <p className="text-xs font-semibold mb-1.5" style={{ color: accent }}>{label}</p>
      <div className="space-y-0.5 font-mono text-xs" style={{ color: 'var(--tb-text-secondary)' }}>
        {state.temperature != null && <p>T = {state.temperature.toFixed(2)} K</p>}
        {state.pressure    != null && <p>P = {(state.pressure / 1000).toFixed(2)} kPa</p>}
        {state.enthalpy    != null && <p>h = {(state.enthalpy  / 1000).toFixed(2)} kJ/kg</p>}
        {state.entropy     != null && <p>s = {(state.entropy   / 1000).toFixed(4)} kJ/(kg·K)</p>}
        {state.quality     != null && <p>x = {state.quality.toFixed(3)}</p>}
      </div>
    </div>
  );
}
