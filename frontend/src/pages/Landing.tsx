import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BarChart2,
  Cpu,
  FlaskConical,
  LayoutDashboard,
  Moon,
  Sun,
  Target,
} from 'lucide-react';
import Logo from '../components/ui/Logo';

// ─────────────────────────────────────────────────────────────────────────────
// Palette — deep burgundy + rich navy, used sparingly and deliberately.
// Everything else is neutral slate + hairline borders, not shadows/gradients.
// ─────────────────────────────────────────────────────────────────────────────
const RED = '#7A2333';
const BLUE = '#274873';
const MONO = "'JetBrains Mono', ui-monospace, monospace";

const FEATURES = [
  { n: '01', title: 'Simulation Canvas', text: 'Drag components, connect flow paths, run the model.', icon: LayoutDashboard },
  { n: '02', title: 'Property Calculator', text: 'CoolProp-backed fluid properties from any two known states.', icon: FlaskConical },
  { n: '03', title: 'Equation Solver', text: 'EES-style scripting with inline property lookups.', icon: Cpu },
  { n: '04', title: 'Parametric Analysis', text: 'Sweep a variable across a range without rebuilding the case.', icon: Target },
  { n: '05', title: 'Results', text: 'Energy, entropy, and exergy — component and system level.', icon: BarChart2 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Shared panel chrome — a small "app window" frame reused by all four
// capability panels below, so they read as one consistent visual language.
// ─────────────────────────────────────────────────────────────────────────────
function PanelFrame({ isLight, filename, children }: { isLight: boolean; filename: string; children: React.ReactNode }) {
  return (
    <div
      className="overflow-hidden rounded-lg border"
      style={{
        borderColor: isLight ? '#e2e8f0' : 'rgba(148,163,184,0.18)',
        background: isLight ? '#ffffff' : '#050a14',
      }}
    >
      <div
        className="flex h-9 items-center gap-2 border-b px-4"
        style={{ borderColor: isLight ? '#e2e8f0' : 'rgba(148,163,184,0.14)' }}
      >
        <span className="h-2 w-2 rounded-full" style={{ background: RED, opacity: 0.55 }} />
        <span className="h-2 w-2 rounded-full" style={{ background: '#cbd5e1', opacity: isLight ? 1 : 0.25 }} />
        <span className="h-2 w-2 rounded-full" style={{ background: BLUE, opacity: 0.55 }} />
        <span className="ml-2 text-xs" style={{ fontFamily: MONO, color: isLight ? '#94a3b8' : '#64748b' }}>
          {filename}
        </span>
      </div>
      {children}
    </div>
  );
}

// ── Equation solver ─────────────────────────────────────────────────────────
const CODE_LINES: { text: string; tone: 'kw' | 'val' | 'comment' | 'plain' }[][] = [
  [{ text: '# isentropic compressor', tone: 'comment' }],
  [{ text: 'T1', tone: 'plain' }, { text: ' = ', tone: 'plain' }, { text: '300', tone: 'val' }, { text: ' [K]', tone: 'comment' }],
  [{ text: 'P1', tone: 'plain' }, { text: ' = ', tone: 'plain' }, { text: '101.3', tone: 'val' }, { text: ' [kPa]', tone: 'comment' }],
  [{ text: 'h1', tone: 'plain' }, { text: ' = ', tone: 'plain' }, { text: 'Enthalpy', tone: 'kw' }, { text: '(Water, T=T1, P=P1)', tone: 'plain' }],
  [{ text: 's1', tone: 'plain' }, { text: ' = ', tone: 'plain' }, { text: 'Entropy', tone: 'kw' }, { text: '(Water, T=T1, P=P1)', tone: 'plain' }],
  [{ text: '', tone: 'plain' }],
  [{ text: 'P2', tone: 'plain' }, { text: ' = ', tone: 'plain' }, { text: '500', tone: 'val' }, { text: ' [kPa]', tone: 'comment' }],
  [{ text: 'h2', tone: 'plain' }, { text: ' = ', tone: 'plain' }, { text: 'Enthalpy', tone: 'kw' }, { text: '(Water, P=P2, S=s1)', tone: 'plain' }],
  [{ text: 'w_comp', tone: 'plain' }, { text: ' = ', tone: 'plain' }, { text: 'h2 - h1', tone: 'plain' }],
];

function toneColor(tone: string, isLight: boolean) {
  if (tone === 'kw') return BLUE;
  if (tone === 'val') return RED;
  if (tone === 'comment') return isLight ? '#94a3b8' : '#64748b';
  return isLight ? '#334155' : '#cbd5e1';
}

function CodePanel({ isLight }: { isLight: boolean }) {
  return (
    <PanelFrame isLight={isLight} filename="compressor.tbs">
      <div className="px-4 py-4 text-[13px] leading-relaxed" style={{ fontFamily: MONO }}>
        {CODE_LINES.map((line, i) => (
          <div key={i} className="flex gap-4">
            <span style={{ color: isLight ? '#cbd5e1' : '#334155', userSelect: 'none' }} className="w-4 flex-shrink-0 text-right">
              {i + 1}
            </span>
            <span>
              {line.map((tok, j) => (
                <span key={j} style={{ color: toneColor(tok.tone, isLight) }}>{tok.text}</span>
              ))}
              {line.length === 0 || (line.length === 1 && line[0].text === '') ? '\u00A0' : ''}
            </span>
          </div>
        ))}
      </div>
    </PanelFrame>
  );
}

// ── Property lookups ────────────────────────────────────────────────────────
function PropertyRow({ label, value, unit, isLight, dim }: { label: string; value: string; unit?: string; isLight: boolean; dim?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span style={{ color: isLight ? '#64748b' : '#64748b' }}>{label}</span>
      <span>
        <span style={{ color: dim ? (isLight ? '#334155' : '#cbd5e1') : RED, fontWeight: dim ? 400 : 600 }}>{value}</span>
        {unit && <span className="ml-1" style={{ color: isLight ? '#94a3b8' : '#64748b' }}>{unit}</span>}
      </span>
    </div>
  );
}

function PropertyPanel({ isLight }: { isLight: boolean }) {
  return (
    <PanelFrame isLight={isLight} filename="properties.calc">
      <div className="px-4 py-4 text-[13px]" style={{ fontFamily: MONO }}>
        <PropertyRow label="fluid" value="Water" isLight={isLight} dim />
        <PropertyRow label="T" value="300.00" unit="[K]" isLight={isLight} dim />
        <PropertyRow label="P" value="101.30" unit="[kPa]" isLight={isLight} dim />
        <div className="my-2 border-t" style={{ borderColor: isLight ? '#e2e8f0' : 'rgba(148,163,184,0.14)' }} />
        <PropertyRow label="h" value="112.56" unit="[kJ/kg]" isLight={isLight} />
        <PropertyRow label="s" value="0.3931" unit="[kJ/kg·K]" isLight={isLight} />
        <PropertyRow label="ρ" value="996.71" unit="[kg/m³]" isLight={isLight} />
        <PropertyRow label="cp" value="4.1796" unit="[kJ/kg·K]" isLight={isLight} />
      </div>
    </PanelFrame>
  );
}

// ── Cycle simulation (canvas) ───────────────────────────────────────────────
function CyclePanel({ isLight }: { isLight: boolean }) {
  const nodeStroke = isLight ? '#274873' : '#4a6f9c';
  const nodeFill = isLight ? '#ffffff' : '#0a0f18';
  const nodeText = isLight ? '#334155' : '#cbd5e1';
  const lineColor = isLight ? '#94a3b8' : '#475569';

  const nodes = [
    { x: 46, y: 24, label: 'Compressor' },
    { x: 174, y: 24, label: 'Condenser' },
    { x: 174, y: 100, label: 'Exp. Valve' },
    { x: 46, y: 100, label: 'Evaporator' },
  ];

  return (
    <PanelFrame isLight={isLight} filename="cycle.canvas">
      <div className="flex items-center justify-center px-4 py-6">
        <svg viewBox="0 0 220 130" width="100%" height="150">
          <line x1="86" y1="24" x2="134" y2="24" stroke={lineColor} strokeWidth="1.5" markerEnd="url(#arrow)" />
          <line x1="174" y1="44" x2="174" y2="80" stroke={lineColor} strokeWidth="1.5" markerEnd="url(#arrow)" />
          <line x1="134" y1="100" x2="86" y2="100" stroke={lineColor} strokeWidth="1.5" markerEnd="url(#arrow)" />
          <line x1="46" y1="80" x2="46" y2="44" stroke={lineColor} strokeWidth="1.5" markerEnd="url(#arrow)" />
          <defs>
            <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill={lineColor} />
            </marker>
          </defs>

          {[{ x: 110, y: 24, n: '2' }, { x: 174, y: 62, n: '3' }, { x: 110, y: 100, n: '4' }, { x: 46, y: 62, n: '1' }].map((s) => (
            <g key={s.n}>
              <circle cx={s.x} cy={s.y} r="7" fill={RED} opacity="0.9" />
              <text x={s.x} y={s.y + 3} textAnchor="middle" fontSize="8" fill="#fff" fontFamily={MONO}>{s.n}</text>
            </g>
          ))}

          {nodes.map((n) => (
            <g key={n.label}>
              <rect x={n.x - 34} y={n.y - 14} width="68" height="28" rx="5" fill={nodeFill} stroke={nodeStroke} strokeWidth="1.3" />
              <text x={n.x} y={n.y + 3} textAnchor="middle" fontSize="8.5" fill={nodeText} fontFamily={MONO}>{n.label}</text>
            </g>
          ))}
        </svg>
      </div>
    </PanelFrame>
  );
}

// ── Parametric studies (sweep) ──────────────────────────────────────────────
function ParametricPanel({ isLight }: { isLight: boolean }) {
  const axisColor = isLight ? '#cbd5e1' : '#334155';
  const textColor = isLight ? '#94a3b8' : '#64748b';
  const points = [[10, 90], [45, 72], [80, 58], [115, 48], [150, 42], [185, 40]];
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ');

  return (
    <PanelFrame isLight={isLight} filename="sweep.run">
      <div className="px-4 py-5">
        <svg viewBox="0 0 210 110" width="100%" height="140">
          <line x1="10" y1="10" x2="10" y2="95" stroke={axisColor} strokeWidth="1" />
          <line x1="10" y1="95" x2="195" y2="95" stroke={axisColor} strokeWidth="1" />
          <path d={path} fill="none" stroke={BLUE} strokeWidth="1.8" />
          {points.map((p, i) => (
            <circle key={i} cx={p[0]} cy={p[1]} r="2.6" fill={RED} />
          ))}
          <text x="10" y="106" fontSize="7.5" fill={textColor} fontFamily={MONO}>P_cond [kPa]</text>
          <text x="10" y="8" fontSize="7.5" fill={textColor} fontFamily={MONO}>COP</text>
        </svg>
      </div>
    </PanelFrame>
  );
}

function LandingNav({ isLight, onToggleTheme }: { isLight: boolean; onToggleTheme: () => void }) {
  const jump = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <header
      className="sticky top-0 z-50 border-b"
      style={{
        background: isLight ? 'rgba(255,255,255,0.92)' : 'rgba(3,7,17,0.92)',
        borderColor: isLight ? '#e2e8f0' : 'rgba(148,163,184,0.14)',
        backdropFilter: 'blur(10px)',
      }}
    >
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6">
        <Link to="/">
          <Logo size={20} wordmarkClassName={`text-sm ${isLight ? 'text-slate-900' : 'text-slate-100'}`} />
        </Link>

        <nav className={`hidden items-center gap-6 text-sm lg:flex ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
          <a href="#features" onClick={jump('features')}>Features</a>
          <a href="#workflow" onClick={jump('workflow')}>Workflow</a>
          <a href="#about" onClick={jump('about')}>About</a>
        </nav>

        <div className="flex items-center gap-2">
          <button
            onClick={onToggleTheme}
            className="flex h-7 w-7 items-center justify-center rounded border"
            style={{ borderColor: isLight ? '#e2e8f0' : 'rgba(148,163,184,0.2)', color: isLight ? '#475569' : '#cbd5e1' }}
            title="Toggle light/dark theme"
          >
            {isLight ? <Moon size={13} /> : <Sun size={13} />}
          </button>
          <Link
            to="/dashboard"
            className="rounded px-3 py-1.5 text-sm font-medium text-white"
            style={{ background: BLUE }}
          >
            Open Workspace
          </Link>
        </div>
      </div>
    </header>
  );
}

function Hero({ isLight }: { isLight: boolean }) {
  return (
    <section className="mx-auto w-full max-w-5xl px-6 pb-16 pt-16">
      <div className="mb-6 inline-block text-xs" style={{ fontFamily: MONO, color: '#64748b' }}>
        // open source · runs in your browser
      </div>
      <h1 className={`max-w-2xl text-4xl font-semibold leading-[1.15] tracking-tight ${isLight ? 'text-slate-900' : 'text-white'} md:text-5xl`}>
        Thermodynamic cycle analysis, without the desktop license.
      </h1>
      <p className={`mt-5 max-w-lg text-base leading-relaxed ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
        Property lookups, an equation solver, cycle simulation, and parametric
        studies — one workspace, no install, no account.
      </p>

      <div className="mt-7 flex items-center gap-3">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-2 rounded px-4 py-2.5 text-sm font-medium text-white"
          style={{ background: BLUE }}
        >
          Open Workspace <ArrowRight size={14} />
        </Link>
        <a
          href="#features"
          onClick={(e) => { e.preventDefault(); document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' }); }}
          className="inline-flex items-center gap-2 rounded border px-4 py-2.5 text-sm font-medium"
          style={{ borderColor: isLight ? '#cbd5e1' : 'rgba(148,163,184,0.25)', color: isLight ? '#334155' : '#cbd5e1' }}
        >
          See what's inside
        </a>
      </div>

      <div className="mt-14 grid gap-8 md:grid-cols-2 md:items-center">
        <CodePanel isLight={isLight} />
        <div>
          <p className={`text-xs uppercase tracking-wide ${isLight ? 'text-slate-400' : 'text-slate-500'}`} style={{ fontFamily: MONO }}>
            Solved inline, not looked up
          </p>
          <p className={`mt-2 text-sm leading-relaxed ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
            Write the governing equations directly. Property calls resolve against
            CoolProp behind the scenes — no separate lookup step, no copy-pasting
            values between a table and a spreadsheet.
          </p>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Capabilities — one panel + caption pair per core tool, alternating sides.
// ─────────────────────────────────────────────────────────────────────────────
function CapabilityRow({
  isLight, panel, reverse, eyebrow, text,
}: {
  isLight: boolean; panel: React.ReactNode; reverse?: boolean; eyebrow: string; text: string;
}) {
  return (
    <div className="grid gap-8 py-10 md:grid-cols-2 md:items-center">
      <div className={reverse ? 'md:order-2' : ''}>{panel}</div>
      <div className={reverse ? 'md:order-1' : ''}>
        <p className={`text-xs uppercase tracking-wide ${isLight ? 'text-slate-400' : 'text-slate-500'}`} style={{ fontFamily: MONO }}>
          {eyebrow}
        </p>
        <p className={`mt-2 text-sm leading-relaxed ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>{text}</p>
      </div>
    </div>
  );
}

function CapabilitiesSection({ isLight }: { isLight: boolean }) {
  return (
    <section className="border-t" style={{ borderColor: isLight ? '#e2e8f0' : 'rgba(148,163,184,0.14)' }}>
      <div className="mx-auto w-full max-w-5xl divide-y px-6" style={{ borderColor: isLight ? '#e2e8f0' : 'rgba(148,163,184,0.14)' }}>
        <CapabilityRow
          isLight={isLight}
          panel={<PropertyPanel isLight={isLight} />}
          eyebrow="Two known states, full state"
          text="Give any two independent properties and get the rest — enthalpy, entropy, density, specific heat — without opening a property table or interpolating by hand."
        />
        <CapabilityRow
          isLight={isLight}
          panel={<CyclePanel isLight={isLight} />}
          reverse
          eyebrow="Build the topology, not the algebra"
          text="Drag components onto the canvas and connect flow paths. State points are numbered automatically — the topology drives the model instead of manually wiring energy balances between components."
        />
        <CapabilityRow
          isLight={isLight}
          panel={<ParametricPanel isLight={isLight} />}
          eyebrow="Sweep once, compare everything"
          text="Pick a variable and a range, and run every case in one pass — no rebuilding the model or re-entering inputs for each point on the curve."
        />
      </div>
    </section>
  );
}

function AboutSection({ isLight }: { isLight: boolean }) {
  return (
    <section id="about" className="border-t" style={{ borderColor: isLight ? '#e2e8f0' : 'rgba(148,163,184,0.14)' }}>
      <div className="mx-auto w-full max-w-5xl px-6 py-16">
        <p className="text-xs uppercase tracking-wide" style={{ fontFamily: MONO, color: isLight ? '#94a3b8' : '#64748b' }}>
          What it is
        </p>
        <div className="mt-4 grid gap-8 md:grid-cols-2">
          <p className={`text-base leading-relaxed ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
            ThermoBird replaces the usual pile of property tables, spreadsheets,
            and disconnected scripts with one browser-based workflow for
            thermodynamic cycle analysis — Rankine, Brayton, vapor-compression,
            and custom configurations.
          </p>
          <p className={`text-base leading-relaxed ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
            Built for students learning first- and second-law analysis, engineers
            screening cycle concepts, and anyone who wants CoolProp-backed
            properties without opening a textbook appendix.
          </p>
        </div>
      </div>
    </section>
  );
}

function FeaturesSection({ isLight }: { isLight: boolean }) {
  return (
    <section id="features" className="border-t" style={{ borderColor: isLight ? '#e2e8f0' : 'rgba(148,163,184,0.14)' }}>
      <div className="mx-auto w-full max-w-5xl px-6 py-16">
        <p className="text-xs uppercase tracking-wide" style={{ fontFamily: MONO, color: isLight ? '#94a3b8' : '#64748b' }}>
          Five tools, one workspace
        </p>

        <div className="mt-6 divide-y" style={{ borderColor: isLight ? '#e2e8f0' : 'rgba(148,163,184,0.14)' }}>
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <div
                key={f.n}
                className="flex items-start gap-5 border-t py-5 first:border-t-0"
                style={{ borderColor: isLight ? '#e2e8f0' : 'rgba(148,163,184,0.14)' }}
              >
                <span className="w-7 flex-shrink-0 pt-0.5 text-sm" style={{ fontFamily: MONO, color: isLight ? '#cbd5e1' : '#475569' }}>
                  {f.n}
                </span>
                <Icon size={17} className="mt-0.5 flex-shrink-0" style={{ color: BLUE }} />
                <div className="flex flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 className={`text-sm font-semibold ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>{f.title}</h3>
                  <p className={`text-sm ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{f.text}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function WorkflowSection({ isLight }: { isLight: boolean }) {
  const steps = [
    'Build the cycle on the canvas, or write it directly as a script.',
    'Pull fluid properties and solve governing equations inline.',
    'Run steady-state or parametric sweeps with consistent inputs.',
    'Read energy, exergy, and entropy results, component and system level.',
  ];

  return (
    <section id="workflow" className="border-t" style={{ borderColor: isLight ? '#e2e8f0' : 'rgba(148,163,184,0.14)' }}>
      <div className="mx-auto w-full max-w-5xl px-6 py-16">
        <p className="text-xs uppercase tracking-wide" style={{ fontFamily: MONO, color: isLight ? '#94a3b8' : '#64748b' }}>
          How it works
        </p>

        <div className="mt-6 grid gap-x-8 gap-y-6 md:grid-cols-2">
          {steps.map((s, i) => (
            <div key={s} className="flex items-start gap-3">
              <span
                className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-medium text-white"
                style={{ background: i % 2 === 0 ? BLUE : RED }}
              >
                {i + 1}
              </span>
              <span className={`text-sm leading-relaxed ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>{s}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function AuthorSection({ isLight }: { isLight: boolean }) {
  const lines = [
    'Mohammed Jamal',
    'Mechanical Engineer & BIM Modeller — MEP Design',
    'Nova Engineering',
    'Thermodynamics · Energy Systems · HVAC · Applied AI',
  ];
  return (
    <section className="border-t" style={{ borderColor: isLight ? '#e2e8f0' : 'rgba(148,163,184,0.14)' }}>
      <div className="mx-auto flex w-full max-w-5xl items-center gap-4 px-6 py-14">
        <div
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
          style={{ background: BLUE }}
        >
          MJ
        </div>
        <div className="text-sm leading-relaxed">
          <p className={`font-medium ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>{lines[0]}</p>
          <p className={isLight ? 'text-slate-600' : 'text-slate-400'}>{lines[1]}</p>
          <p className={isLight ? 'text-slate-600' : 'text-slate-400'}>{lines[2]}</p>
          <p className={`mt-0.5 text-xs ${isLight ? 'text-slate-400' : 'text-slate-500'}`} style={{ fontFamily: MONO }}>{lines[3]}</p>
        </div>
      </div>
    </section>
  );
}

function ClosingCTA({ isLight }: { isLight: boolean }) {
  return (
    <section className="border-t" style={{ borderColor: isLight ? '#e2e8f0' : 'rgba(148,163,184,0.14)' }}>
      <div className="mx-auto w-full max-w-5xl px-6 py-16 text-center">
        <h3 className={`text-2xl font-semibold ${isLight ? 'text-slate-900' : 'text-white'}`}>Ready to model your first cycle?</h3>
        <p className={`mx-auto mt-2 max-w-md text-sm ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
          No account needed — open the workspace and start building.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 rounded px-4 py-2.5 text-sm font-medium text-white"
            style={{ background: BLUE }}
          >
            Open Workspace <ArrowRight size={14} />
          </Link>
          <Link
            to="/simulations"
            className="inline-flex items-center gap-2 rounded border px-4 py-2.5 text-sm font-medium"
            style={{ borderColor: isLight ? '#cbd5e1' : 'rgba(148,163,184,0.25)', color: isLight ? '#334155' : '#cbd5e1' }}
          >
            Browse Simulations
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer({ isLight }: { isLight: boolean }) {
  return (
    <footer className="border-t" style={{ borderColor: isLight ? '#e2e8f0' : 'rgba(148,163,184,0.14)' }}>
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-3 px-6 py-8 sm:flex-row">
        <Logo size={16} wordmarkClassName={`text-xs ${isLight ? 'text-slate-600' : 'text-slate-400'}`} />
        <p className={`text-xs ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>Open source thermodynamic analysis</p>
      </div>
    </footer>
  );
}

export default function Landing() {
  const [isLight, setIsLight] = useState(true);

  return (
    <div className={`min-h-screen ${isLight ? 'bg-white text-slate-900' : 'bg-[#03070f] text-slate-100'}`}>
      <LandingNav isLight={isLight} onToggleTheme={() => setIsLight((v) => !v)} />
      <Hero isLight={isLight} />
      <CapabilitiesSection isLight={isLight} />
      <AboutSection isLight={isLight} />
      <FeaturesSection isLight={isLight} />
      <WorkflowSection isLight={isLight} />
      <AuthorSection isLight={isLight} />
      <ClosingCTA isLight={isLight} />
      <Footer isLight={isLight} />
    </div>
  );
}
