/**
 * exportUtils.ts  —  ThermoBird export utilities
 *
 * exportCanvasCSV      — all tabulated canvas results in one clean multi-section CSV
 * exportCanvasPDF      — full professional PDF report (all sections + topology + diagrams)
 * exportSolverCSV      — solver variables table as CSV
 * exportSolverPDF      — solver results as PDF
 * exportParametricCSV  — parametric sweep matrix (unchanged)
 */
import type { CanvasComponent, CanvasConnection } from '../store/cycleStore';
import { computeStateNumbers } from '../store/cycleStore';

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Trigger a file download from a string blob */
function download(filename: string, content: string, mime = 'text/csv;charset=utf-8;') {
  // Prepend UTF-8 BOM so Excel opens the file with correct encoding (no Arabic/garbage chars)
  const bom  = '\uFEFF';
  const blob = new Blob([bom + content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Safely escape a CSV cell value — no special chars will leak out */
function cell(v: string | number | null | undefined): string {
  const s = String(v ?? '');
  // Strip/replace any problematic unicode that isn't standard ASCII or basic latin
  const clean = s
    .replace(/\u0000/g, '')           // null bytes
    .replace(/[\u0600-\u06FF]/g, '')  // Arabic block (just in case)
    .replace(/"/g, '""');             // escape double-quotes
  return `"${clean}"`;
}

/** Format a number safely */
function f(v: any, dp = 3): string {
  if (v == null || (typeof v === 'number' && !isFinite(v))) return '';
  return Number(v).toFixed(dp);
}

function pct(v: any): string {
  if (v == null) return '';
  return `${(Number(v) * 100).toFixed(2)}%`;
}

/** Build a CSV string from headers + rows */
function buildCSV(
  headers: { key: string; label: string }[],
  rows: Record<string, string | number | null | undefined>[],
): string {
  const head = headers.map(h => cell(h.label)).join(',');
  const body = rows.map(r => headers.map(h => cell(r[h.key])).join(','));
  return [head, ...body].join('\r\n');
}

/** Append a labelled section to a CSV string (blank line separator + section title) */
function csvSection(title: string, csv: string): string {
  return `\r\n${cell(title)}\r\n${csv}\r\n`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Canvas results  —  CSV  (all tables in one file, multi-section)
// ─────────────────────────────────────────────────────────────────────────────

export function exportCanvasCSV(results: any, fluid: string, simName = 'simulation') {
  const spts  = results.state_points      ?? [];
  const comps = results.component_metrics ?? [];
  const eb    = results.energy_balance    ?? {};
  const entr  = results.entropy           ?? {};
  const exrg  = results.exergy            ?? {};
  const perf  = results.performance       ?? {};

  const sections: string[] = [];

  // ── 1. Performance KPIs ──
  const kpiRows: Record<string, string>[] = [];
  const addKPI = (metric: string, value: string, unit: string) =>
    kpiRows.push({ metric, value, unit });

  if (perf.thermal_efficiency != null) addKPI('Thermal Efficiency (eta_th)', pct(perf.thermal_efficiency), '%');
  if (perf.carnot_efficiency   != null) addKPI('Carnot Efficiency (eta_c)',   pct(perf.carnot_efficiency),  '%');
  if (perf.net_power_kW        != null) addKPI('Net Power',                   f(perf.net_power_kW, 3),      'kW');
  if (perf.cop_cooling         != null) addKPI('COP (Cooling)',               f(perf.cop_cooling, 4),       '-');
  if (perf.cop_carnot          != null) addKPI('COP (Carnot)',                f(perf.cop_carnot, 4),        '-');
  if (perf.cooling_capacity_kW != null) addKPI('Cooling Capacity',            f(perf.cooling_capacity_kW, 3), 'kW');
  if (perf.second_law_efficiency != null || exrg.exergy_efficiency != null)
    addKPI('Exergy Efficiency (eta_ex)', pct(exrg.exergy_efficiency ?? perf.second_law_efficiency), '%');

  if (kpiRows.length > 0)
    sections.push(csvSection('PERFORMANCE METRICS',
      buildCSV([{ key: 'metric', label: 'Metric' }, { key: 'value', label: 'Value' }, { key: 'unit', label: 'Unit' }], kpiRows)));

  // ── 2. State Points ──
  if (spts.length > 0)
    sections.push(csvSection('STATE POINTS',
      buildCSV([
        { key: 'label',     label: 'State'         },
        { key: 'T_K',       label: 'T [K]'         },
        { key: 'T_C',       label: 'T [deg C]'     },
        { key: 'P_kPa',     label: 'P [kPa]'       },
        { key: 'h_kJ_kg',   label: 'h [kJ/kg]'     },
        { key: 's_kJ_kgK',  label: 's [kJ/(kg K)]' },
        { key: 'x',         label: 'Quality x'     },
        { key: 'phase',     label: 'Phase'         },
      ],
      spts.map((sp: any) => ({
        label:    sp.label ?? sp.name ?? '',
        T_K:      f(sp.T_K, 3),
        T_C:      f(sp.T_C, 2),
        P_kPa:    f(sp.P_kPa, 3),
        h_kJ_kg:  f(sp.h_kJ_kg, 4),
        s_kJ_kgK: f(sp.s_kJ_kgK, 6),
        x:        sp.x != null ? f(sp.x, 4) : 'N/A',
        phase:    sp.phase ?? '',
      })))));

  // ── 3. Component Analysis ──
  if (comps.length > 0)
    sections.push(csvSection('COMPONENT ANALYSIS',
      buildCSV([
        { key: 'name',     label: 'Component'          },
        { key: 'work_kW',  label: 'Work [kW]'          },
        { key: 'heat_kW',  label: 'Heat [kW]'          },
        { key: 'eta_is',   label: 'Isentropic Eff.'    },
        { key: 'sgen',     label: 'S_gen [W/K]'        },
        { key: 'sgen_pct', label: 'S_gen Share [%]'    },
        { key: 'exd',      label: 'Ex_dest [kW]'       },
        { key: 'exd_pct',  label: 'Ex_dest Share [%]'  },
      ],
      comps.map((c: any) => ({
        name:     c.name ?? '',
        work_kW:  c.work_kW != null ? f(c.work_kW, 4) : 'N/A',
        heat_kW:  c.heat_kW != null ? f(c.heat_kW, 4) : 'N/A',
        eta_is:   c.isentropic_efficiency != null ? pct(c.isentropic_efficiency) : 'N/A',
        sgen:     c.entropy_gen_W_per_K != null ? f(c.entropy_gen_W_per_K, 6) : '',
        sgen_pct: c.entropy_gen_share_pct != null ? f(c.entropy_gen_share_pct, 2) : '',
        exd:      c.exergy_destruction_kW != null ? f(c.exergy_destruction_kW, 4) : '',
        exd_pct:  (() => {
          const share = exrg.component_breakdown?.find((b: any) => b.name === c.name)?.exergy_destruction_share;
          return share != null ? f(share, 2) : '';
        })(),
      })))));

  // ── 4. Cycle Totals  ──
  const totRows: Record<string, string>[] = [];
  const addTot = (metric: string, value: string, unit: string) =>
    totRows.push({ metric, value, unit });

  if (eb.total_heat_input_kW   != null) addTot('Total Heat Input',     f(eb.total_heat_input_kW, 3),  'kW');
  if (eb.total_heat_output_kW  != null) addTot('Total Heat Output',    f(eb.total_heat_output_kW, 3), 'kW');
  if (eb.total_work_input_kW   != null) addTot('Total Work Input',     f(eb.total_work_input_kW, 3),  'kW');
  if (eb.total_work_output_kW  != null) addTot('Total Work Output',    f(eb.total_work_output_kW, 3), 'kW');
  if (eb.net_work_kW           != null) addTot('Net Work',             f(eb.net_work_kW, 3),          'kW');
  if (eb.energy_balance_error_percent != null)
    addTot('Energy Balance Error', f(eb.energy_balance_error_percent, 4), '%');

  if (entr.total_Sgen_W_per_K  != null) addTot('Total Entropy Generation',   f(entr.total_Sgen_W_per_K, 5),        'W/K');
  if (exrg.total_exergy_destruction_kW != null)
    addTot('Total Exergy Destruction', f(exrg.total_exergy_destruction_kW, 4), 'kW');
  if (exrg.exergy_efficiency   != null) addTot('Exergy Efficiency',          pct(exrg.exergy_efficiency),           '%');

  if (totRows.length > 0)
    sections.push(csvSection('CYCLE TOTALS',
      buildCSV([{ key: 'metric', label: 'Metric' }, { key: 'value', label: 'Value' }, { key: 'unit', label: 'Unit' }], totRows)));

  // ── 5. Entropy Generation Breakdown ──
  if (entr.component_breakdown?.length > 0)
    sections.push(csvSection('ENTROPY GENERATION BREAKDOWN',
      buildCSV([
        { key: 'name',      label: 'Component'    },
        { key: 'sgen',      label: 'S_gen [W/K]'  },
        { key: 'share',     label: 'Share [%]'    },
      ],
      entr.component_breakdown.map((b: any) => ({
        name:  b.name ?? '',
        sgen:  f(b.Sgen_W_per_K, 5),
        share: f(b.share_pct, 2),
      })))));

  // ── 6. Exergy Destruction Breakdown ──
  if (exrg.component_breakdown?.length > 0)
    sections.push(csvSection('EXERGY DESTRUCTION BREAKDOWN',
      buildCSV([
        { key: 'name',      label: 'Component'        },
        { key: 'exd',       label: 'Ex_dest [kW]'     },
        { key: 'share',     label: 'Share [%]'        },
      ],
      exrg.component_breakdown.map((b: any) => ({
        name:  b.name ?? '',
        exd:   f(b.exergy_destruction_kW, 4),
        share: f(b.exergy_destruction_share, 2),
      })))));

  const filename = `thermobird_${simName.replace(/[^a-zA-Z0-9_-]/g, '_')}_${fluid}_results.csv`;
  download(filename, sections.join(''));
}

// ─────────────────────────────────────────────────────────────────────────────
// Solver results  —  CSV
// ─────────────────────────────────────────────────────────────────────────────

export function exportSolverCSV(variables: Record<string, any>, scriptName = 'solver') {
  const numRows = Object.entries(variables)
    .filter(([, v]) => typeof v === 'number')
    .map(([name, value]) => ({ name, value: f(value, 6), type: 'Numeric' }));

  const strRows = Object.entries(variables)
    .filter(([, v]) => typeof v === 'string')
    .map(([name, value]) => ({ name, value: String(value), type: 'String' }));

  const rows = [...numRows, ...strRows];
  const csv  = buildCSV(
    [{ key: 'name', label: 'Variable' }, { key: 'value', label: 'Value' }, { key: 'type', label: 'Type' }],
    rows,
  );
  download(`thermobird_solver_${scriptName.replace(/[^a-zA-Z0-9_-]/g, '_')}.csv`, csv);
}

// ─────────────────────────────────────────────────────────────────────────────
// Parametric  —  CSV  (unchanged logic, encoding fixed)
// ─────────────────────────────────────────────────────────────────────────────

export function exportParametricCSV(
  result: { axes: any[]; outputs: Record<string, (number | null)[]>; run_count: number },
  studyName: string,
) {
  const axisNames   = result.axes.map((a: any) => a.name);
  const outputNames = Object.keys(result.outputs);
  const allVars     = [...axisNames, ...outputNames.filter(n => !axisNames.includes(n))];
  const headers     = allVars.map(n => ({ key: n, label: n }));
  const rows: Record<string, string>[] = [];

  for (let i = 0; i < result.run_count; i++) {
    const row: Record<string, string> = {};
    let rem = i;
    for (let ax = result.axes.length - 1; ax >= 0; ax--) {
      const len = result.axes[ax].values.length;
      row[result.axes[ax].name] = String(result.axes[ax].values[rem % len] ?? '');
      rem = Math.floor(rem / len);
    }
    for (const n of outputNames) row[n] = String(result.outputs[n]?.[i] ?? '');
    rows.push(row);
  }

  download(`thermobird_parametric_${studyName.replace(/[^a-zA-Z0-9_-]/g, '_')}.csv`, buildCSV(headers, rows));
}

// ─────────────────────────────────────────────────────────────────────────────
// Topology SVG builder  —  produces a clean, print-ready cycle diagram
// from raw components + connections (no DOM, pure data → SVG string)
// ─────────────────────────────────────────────────────────────────────────────

const COMP_ICON: Record<string, string> = {
  turbine:         '⚙',
  pump:            '💧',
  compressor:      '🔧',
  boiler:          '🔥',
  condenser:       '❄',
  evaporator:      '🌡',
  heat_exchanger:  '🔄',
  expansion_valve: '🔽',
  regenerator:     '♻',
  mixing_chamber:  '🔀',
};

const COMP_COLOR: Record<string, string> = {
  turbine:         '#0369a1',
  pump:            '#0369a1',
  compressor:      '#0369a1',
  boiler:          '#c2410c',
  condenser:       '#0e7490',
  evaporator:      '#0e7490',
  heat_exchanger:  '#6d28d9',
  expansion_valve: '#059669',
  regenerator:     '#6d28d9',
  mixing_chamber:  '#475569',
};

function buildTopologySVG(
  components: CanvasComponent[],
  connections: CanvasConnection[],
  fluid: string,
): string {
  if (components.length === 0) return '';

  // ── 1. Compute state-point numbers (same logic as canvas) ──────────────────
  const stateMap = computeStateNumbers(components, connections);

  // ── 2. Normalise positions to fit a 700×340 viewport with padding ──────────
  const PAD   = 70;
  const SVG_W = 700;
  const SVG_H = 320;
  const NODE_W = 110;
  const NODE_H = 52;

  const xs = components.map(c => c.position.x);
  const ys = components.map(c => c.position.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  const scaleX = (SVG_W - PAD * 2 - NODE_W) / rangeX;
  const scaleY = (SVG_H - PAD * 2 - NODE_H) / rangeY;
  const scale  = Math.min(scaleX, scaleY, 1.4);  // never blow up tiny canvases

  const nx = (x: number) => PAD + (x - minX) * scale;
  const ny = (y: number) => PAD + (y - minY) * scale;

  // ── 3. Build component centre lookup ──────────────────────────────────────
  const centre: Record<string, { x: number; y: number }> = {};
  components.forEach(c => {
    centre[c.id] = { x: nx(c.position.x) + NODE_W / 2, y: ny(c.position.y) + NODE_H / 2 };
  });

  // ── 4. Build connection arrows + state labels ─────────────────────────────
  const arrows: string[] = [];
  connections.forEach(conn => {
    const from = centre[conn.from];
    const to   = centre[conn.to];
    if (!from || !to) return;

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux  = dx / len;
    const uy  = dy / len;

    // shorten line to node edge
    const r = NODE_W / 2 + 4;
    const x1 = (from.x + ux * r).toFixed(1);
    const y1 = (from.y + uy * r).toFixed(1);
    const x2 = (to.x - ux * r).toFixed(1);
    const y2 = (to.y - uy * r).toFixed(1);

    const stateNum = stateMap[`${conn.from}:${conn.fromPort}`];
    const midX = ((from.x + to.x) / 2).toFixed(1);
    const midY = ((from.y + to.y) / 2 - 8).toFixed(1);

    arrows.push(`
      <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
        stroke="#64748b" stroke-width="1.6" marker-end="url(#arrow)"/>
      ${stateNum != null ? `
        <circle cx="${midX}" cy="${(parseFloat(midY) + 4).toFixed(1)}" r="9"
          fill="#0ea5e9" stroke="#fff" stroke-width="1.5"/>
        <text x="${midX}" y="${(parseFloat(midY) + 8.5).toFixed(1)}"
          font-size="8" font-weight="700" fill="#fff" text-anchor="middle">${stateNum}</text>
      ` : ''}
      <text x="${(parseFloat(midX) + 12).toFixed(1)}" y="${(parseFloat(midY) - 2).toFixed(1)}"
        font-size="7" fill="#94a3b8" text-anchor="middle">${fluid}</text>
    `);
  });

  // ── 5. Build component nodes ───────────────────────────────────────────────
  const nodes: string[] = [];
  components.forEach(c => {
    const x   = nx(c.position.x);
    const y   = ny(c.position.y);
    const col = COMP_COLOR[c.type] ?? '#475569';
    const ico = COMP_ICON[c.type] ?? '◆';
    // label: trim to ~14 chars
    const lbl = c.name.length > 15 ? c.name.slice(0, 13) + '…' : c.name;
    const sub = c.type.replace(/_/g, ' ');

    nodes.push(`
      <g>
        <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${NODE_W}" height="${NODE_H}"
          rx="8" fill="white" stroke="${col}" stroke-width="1.8"
          filter="url(#shadow)"/>
        <!-- left accent bar -->
        <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="4" height="${NODE_H}"
          rx="4" fill="${col}"/>
        <!-- icon -->
        <text x="${(x + 18).toFixed(1)}" y="${(y + NODE_H / 2 + 6).toFixed(1)}"
          font-size="16" text-anchor="middle">${ico}</text>
        <!-- name -->
        <text x="${(x + 30).toFixed(1)}" y="${(y + NODE_H / 2 - 3).toFixed(1)}"
          font-size="9.5" font-weight="700" fill="#0f172a">${lbl}</text>
        <!-- type subtitle -->
        <text x="${(x + 30).toFixed(1)}" y="${(y + NODE_H / 2 + 11).toFixed(1)}"
          font-size="7.5" fill="#64748b">${sub}</text>
      </g>
    `);
  });

  // ── 6. Compute actual bounding box of content after scaling ───────────────
  const allNodeX2 = components.map(c => nx(c.position.x) + NODE_W);
  const allNodeY2 = components.map(c => ny(c.position.y) + NODE_H);
  const contentW  = Math.max(...allNodeX2) + PAD;
  const contentH  = Math.max(...allNodeY2) + PAD;
  const vbW = Math.max(contentW, 500);
  const vbH = Math.max(contentH, 200);

  return `<svg xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 ${vbW.toFixed(0)} ${vbH.toFixed(0)}"
    width="${vbW.toFixed(0)}" height="${vbH.toFixed(0)}"
    style="font-family:'Segoe UI',Arial,sans-serif;background:#f8fafc;border-radius:8px;">
    <defs>
      <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
        <path d="M0,0 L0,6 L8,3 z" fill="#64748b"/>
      </marker>
      <filter id="shadow" x="-10%" y="-10%" width="120%" height="130%">
        <feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#0f172a" flood-opacity="0.10"/>
      </filter>
    </defs>
    <!-- background grid dots -->
    <pattern id="dots" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
      <circle cx="1" cy="1" r="0.8" fill="#cbd5e1" opacity="0.5"/>
    </pattern>
    <rect width="100%" height="100%" fill="url(#dots)"/>
    <!-- arrows first (behind nodes) -->
    ${arrows.join('')}
    <!-- nodes on top -->
    ${nodes.join('')}
  </svg>`;
}



const PDF_STYLES = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10.5px; color: #1a202c; background: #fff;
    padding: 28px 36px; line-height: 1.4;
  }
  /* Header */
  .report-header { display: flex; align-items: flex-start; justify-content: space-between;
    margin-bottom: 20px; padding-bottom: 14px; border-bottom: 2px solid #0ea5e9; }
  .report-title { font-size: 22px; font-weight: 800; color: #0ea5e9; letter-spacing: -0.03em; }
  .report-subtitle { font-size: 11px; color: #64748b; margin-top: 3px; }
  .report-badge { background: #0ea5e9; color: #fff; font-size: 9px; font-weight: 700;
    padding: 3px 9px; border-radius: 4px; letter-spacing: 0.05em; margin-top: 6px; display: inline-block; }
  /* Sections */
  .section { margin-bottom: 18px; break-inside: avoid; }
  .section-title {
    font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;
    color: #0ea5e9; margin-bottom: 8px; padding-bottom: 4px;
    border-bottom: 1.5px solid #e2e8f0; display: flex; align-items: center; gap: 6px;
  }
  .section-title .icon { font-size: 12px; }
  /* KPI grid */
  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .kpi {
    background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;
    padding: 10px 12px; border-left: 3px solid #0ea5e9;
  }
  .kpi-label { font-size: 8.5px; color: #64748b; text-transform: uppercase;
    letter-spacing: 0.06em; margin-bottom: 4px; }
  .kpi-value { font-size: 17px; font-weight: 800; color: #0f172a; font-family: 'Courier New', monospace; }
  .kpi-unit  { font-size: 9px; color: #94a3b8; margin-left: 3px; font-weight: 400; }
  /* Tables */
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  thead tr { background: #f1f5f9; }
  th {
    text-align: left; padding: 6px 9px; font-weight: 700; font-size: 8.5px;
    text-transform: uppercase; letter-spacing: 0.05em; color: #475569;
    border-bottom: 2px solid #e2e8f0; white-space: nowrap;
  }
  td { padding: 5px 9px; border-bottom: 1px solid #f1f5f9; font-family: 'Courier New', monospace; }
  tr:nth-child(even) td { background: #f8fafc; }
  td.name-col { font-family: 'Segoe UI', Arial, sans-serif; font-weight: 600; color: #0f172a; }
  td.accent   { color: #0ea5e9; font-weight: 700; }
  td.good     { color: #16a34a; }
  td.bad      { color: #dc2626; }
  /* Totals / balance */
  .balance-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 10px; }
  .balance-card {
    background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 10px;
  }
  .balance-label { font-size: 8.5px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 3px; }
  .balance-value { font-size: 13px; font-weight: 700; color: #0f172a; font-family: 'Courier New', monospace; }
  .balance-note  { font-size: 9px; margin-top: 6px; padding: 5px 9px; border-radius: 4px; }
  .balance-ok    { background: rgba(22,163,74,0.08); color: #16a34a; border: 1px solid rgba(22,163,74,0.2); }
  .balance-warn  { background: rgba(234,179,8,0.08); color: #854d0e; border: 1px solid rgba(234,179,8,0.25); }
  /* Breakdown bars */
  .bar-row { margin-bottom: 9px; }
  .bar-label { display: flex; justify-content: space-between; font-size: 9.5px;
    margin-bottom: 3px; color: #374151; }
  .bar-label .val { font-family: 'Courier New', monospace; font-weight: 700; color: #1a202c; }
  .bar-track { height: 7px; background: #e2e8f0; border-radius: 4px; overflow: hidden; }
  .bar-fill  { height: 100%; border-radius: 4px; }
  /* Commentary */
  .comm-summary { font-size: 11px; line-height: 1.65; color: #374151;
    padding: 10px 14px; background: #f8fafc; border-left: 3px solid #0ea5e9;
    border-radius: 0 8px 8px 0; margin-bottom: 10px; }
  .comm-heading { font-size: 9.5px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.06em; color: #64748b; margin-bottom: 5px; margin-top: 8px; }
  .comm-list { padding-left: 14px; }
  .comm-list li { font-size: 10.5px; color: #374151; margin-bottom: 3px; line-height: 1.5; }
  /* Diagrams */
  .diagram-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .diagram-box  { border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
  .diagram-box img  { width: 100%; display: block; }
  .diagram-label    { font-size: 9px; color: #64748b; text-align: center; padding: 4px;
    background: #f8fafc; border-top: 1px solid #e2e8f0; }
  /* Footer */
  .footer { margin-top: 20px; padding-top: 8px; border-top: 1px solid #e2e8f0;
    display: flex; justify-content: space-between; font-size: 8.5px; color: #94a3b8; }
  /* Print */
  @media print {
    body { padding: 14px 18px; font-size: 9.5px; }
    .section { break-inside: avoid; }
    .diagram-grid { break-inside: avoid; }
  }
`;

function pdfOpen(title: string): Window | null {
  const win = window.open('', '_blank', 'width=960,height=750');
  if (!win) { alert('Pop-up blocked — please allow pop-ups for this site.'); return null; }
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/>
    <title>${title}</title><style>${PDF_STYLES}</style></head><body>`);
  return win;
}

function pdfClose(win: Window) {
  win.document.write('</body></html>');
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 700);
}

function fmtPDF(v: any, dp = 3): string {
  if (v == null || (typeof v === 'number' && !isFinite(v))) return '&mdash;';
  return Number(v).toFixed(dp);
}
function pctPDF(v: any): string {
  return v != null ? `${(Number(v) * 100).toFixed(2)}%` : '&mdash;';
}

// ─────────────────────────────────────────────────────────────────────────────
// Canvas PDF  — professional full report
// ─────────────────────────────────────────────────────────────────────────────

export function exportCanvasPDF(
  results: any,
  fluid: string,
  simName = 'ThermoBird Simulation',
  components: CanvasComponent[] = [],
  connections: CanvasConnection[] = [],
) {
  const win = pdfOpen(`${simName} — ThermoBird Report`);
  if (!win) return;

  const spts  = results.state_points      ?? [];
  const comps = results.component_metrics ?? [];
  const eb    = results.energy_balance    ?? {};
  const entr  = results.entropy           ?? {};
  const exrg  = results.exergy            ?? {};
  const perf  = results.performance       ?? {};
  const comm  = results.commentary        ?? {};
  const isCOP = perf.cop_cooling != null;
  const now   = new Date().toLocaleString();
  const T0    = results.T0 ?? 298.15;

  // ── Header ──────────────────────────────────────────────────────────────────
  win.document.write(`
  <div class="report-header">
    <div>
      <div class="report-title">&#x1F426; ThermoBird</div>
      <div class="report-subtitle">${simName} &nbsp;&middot;&nbsp; Fluid: <strong>${fluid}</strong></div>
      <div class="report-subtitle">Generated: ${now}</div>
    </div>
    <div style="text-align:right">
      <div class="report-badge">SIMULATION REPORT</div>
      <div style="font-size:9px;color:#94a3b8;margin-top:6px;">Quanta Labs &mdash; ThermoBird</div>
    </div>
  </div>`);

  // ── 1. Performance Metrics ──────────────────────────────────────────────────
  win.document.write(`<div class="section">
    <div class="section-title"><span class="icon">&#x26A1;</span> Performance Metrics</div>
    <div class="kpi-grid">`);

  const kpiItems: [string, string, string][] = [];
  if (isCOP) {
    if (perf.cop_cooling         != null) kpiItems.push(['COP (Cooling)',       fmtPDF(perf.cop_cooling, 3),    '']);
    if (perf.cop_carnot          != null) kpiItems.push(['COP (Carnot)',        fmtPDF(perf.cop_carnot, 3),     '']);
    if (perf.cooling_capacity_kW != null) kpiItems.push(['Cooling Capacity',   fmtPDF(perf.cooling_capacity_kW, 2), 'kW']);
  } else {
    if (perf.thermal_efficiency  != null) kpiItems.push(['&eta; Thermal',       pctPDF(perf.thermal_efficiency), '']);
    if (perf.carnot_efficiency   != null) kpiItems.push(['&eta; Carnot',        pctPDF(perf.carnot_efficiency),  '']);
    if (perf.net_power_kW        != null) kpiItems.push(['Net Power',           fmtPDF(perf.net_power_kW, 2),    'kW']);
  }
  const exEff = exrg.exergy_efficiency ?? perf.second_law_efficiency;
  if (exEff != null) kpiItems.push(['&eta; Exergy (2nd Law)', pctPDF(exEff), '']);
  if (entr.total_Sgen_W_per_K != null) kpiItems.push(['&Sigma; S&#775;_gen', fmtPDF(entr.total_Sgen_W_per_K, 4), 'W/K']);
  if (exrg.total_exergy_destruction_kW != null)
    kpiItems.push(['&Sigma; E&#775;x_dest', fmtPDF(exrg.total_exergy_destruction_kW, 3), 'kW']);

  kpiItems.forEach(([label, value, unit]) => {
    win.document.write(`<div class="kpi">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${value}<span class="kpi-unit">${unit}</span></div>
    </div>`);
  });
  win.document.write(`</div></div>`);

  // ── 1b. Cycle Topology ──────────────────────────────────────────────────────
  if (components.length > 0) {
    const topoSVG = buildTopologySVG(components, connections, fluid);
    if (topoSVG) {
      const b64 = btoa(unescape(encodeURIComponent(topoSVG)));
      win.document.write(`<div class="section">
        <div class="section-title"><span class="icon">&#x1F5FA;&#xFE0F;</span> Cycle Topology</div>
        <div style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;background:#f8fafc;">
          <img src="data:image/svg+xml;base64,${b64}" alt="Cycle Topology"
            style="width:100%;display:block;max-height:340px;object-fit:contain;"/>
        </div>
        <div style="font-size:8px;color:#94a3b8;margin-top:4px;text-align:center;">
          ${components.length} components &nbsp;&middot;&nbsp;
          ${connections.length} connections &nbsp;&middot;&nbsp;
          Fluid: ${fluid}
        </div>
      </div>`);
    }
  }

  // ── 2. State Points ─────────────────────────────────────────────────────────
  if (spts.length > 0) {
    win.document.write(`<div class="section">
      <div class="section-title"><span class="icon">&#x1F4CD;</span> State Points</div>
      <table>
        <thead><tr>
          <th>State</th><th>T [K]</th><th>T [&deg;C]</th>
          <th>P [kPa]</th><th>h [kJ/kg]</th><th>s [kJ/(kg&middot;K)]</th>
          <th>Quality x</th><th>Phase</th>
        </tr></thead><tbody>`);
    spts.forEach((sp: any, i: number) => {
      win.document.write(`<tr>
        <td class="accent">${sp.label ?? sp.name ?? i+1}</td>
        <td>${fmtPDF(sp.T_K, 2)}</td>
        <td>${fmtPDF(sp.T_C, 2)}</td>
        <td>${fmtPDF(sp.P_kPa, 2)}</td>
        <td>${fmtPDF(sp.h_kJ_kg, 3)}</td>
        <td>${fmtPDF(sp.s_kJ_kgK, 5)}</td>
        <td>${sp.x != null ? sp.x.toFixed(4) : '&mdash;'}</td>
        <td><strong>${sp.phase ?? ''}</strong></td>
      </tr>`);
    });
    win.document.write(`</tbody></table></div>`);
  }

  // ── 3. Component Analysis ───────────────────────────────────────────────────
  if (comps.length > 0) {
    win.document.write(`<div class="section">
      <div class="section-title"><span class="icon">&#x2699;&#xFE0F;</span> Component Analysis</div>
      <table>
        <thead><tr>
          <th>Component</th><th>W&#775; [kW]</th><th>Q&#775; [kW]</th>
          <th>&eta;_is</th><th>S&#775;_gen [W/K]</th><th>S&#775;_gen Share</th>
          <th>E&#775;x_dest [kW]</th><th>E&#775;x_dest Share</th>
        </tr></thead><tbody>`);
    comps.forEach((c: any) => {
      const exShare = exrg.component_breakdown?.find((b: any) => b.name === c.name)?.exergy_destruction_share;
      win.document.write(`<tr>
        <td class="name-col">${c.name ?? ''}</td>
        <td>${c.work_kW != null ? fmtPDF(c.work_kW, 3) : '&mdash;'}</td>
        <td>${c.heat_kW != null ? fmtPDF(c.heat_kW, 3) : '&mdash;'}</td>
        <td>${c.isentropic_efficiency != null ? pctPDF(c.isentropic_efficiency) : '&mdash;'}</td>
        <td>${c.entropy_gen_W_per_K != null ? fmtPDF(c.entropy_gen_W_per_K, 5) : '&mdash;'}</td>
        <td>${c.entropy_gen_share_pct != null ? fmtPDF(c.entropy_gen_share_pct, 1) + '%' : '&mdash;'}</td>
        <td>${c.exergy_destruction_kW != null ? fmtPDF(c.exergy_destruction_kW, 3) : '&mdash;'}</td>
        <td>${exShare != null ? fmtPDF(exShare, 1) + '%' : '&mdash;'}</td>
      </tr>`);
    });
    win.document.write(`</tbody></table></div>`);
  }

  // ── 4. Cycle Totals ─────────────────────────────────────────────────────────
  win.document.write(`<div class="section">
    <div class="section-title"><span class="icon">&#x1F4CA;</span> Cycle Totals</div>`);

  if (eb.total_heat_input_kW != null) {
    win.document.write(`<div class="balance-grid">`);
    const ebItems: [string, string][] = [
      ['Heat Input',   `${fmtPDF(eb.total_heat_input_kW, 2)} kW`],
      ['Heat Output',  `${fmtPDF(eb.total_heat_output_kW, 2)} kW`],
      ['Work Input',   `${fmtPDF(eb.total_work_input_kW, 2)} kW`],
      ['Work Output',  `${fmtPDF(eb.total_work_output_kW, 2)} kW`],
      ['Net Work',     `${fmtPDF(eb.net_work_kW, 3)} kW`],
      ['Balance Error',`${fmtPDF(eb.energy_balance_error_percent, 3)}%`],
    ];
    ebItems.forEach(([label, value]) => {
      win.document.write(`<div class="balance-card">
        <div class="balance-label">${label}</div>
        <div class="balance-value">${value}</div>
      </div>`);
    });
    win.document.write(`</div>`);
    const isOk = (eb.energy_balance_error_percent ?? 99) < 1;
    win.document.write(`<div class="balance-note ${isOk ? 'balance-ok' : 'balance-warn'}">
      ${isOk ? '&#x2713; Energy balance satisfied' : '&#x26A0; Energy balance error exceeds tolerance &mdash; check inputs'}
    </div>`);
  }

  if (entr.total_Sgen_W_per_K != null || exrg.total_exergy_destruction_kW != null) {
    win.document.write(`<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;">`);
    if (entr.total_Sgen_W_per_K != null) {
      const lostWork = (entr.total_Sgen_W_per_K * T0 / 1000).toFixed(3);
      win.document.write(`<div class="balance-card" style="border-left:3px solid #7c3aed;">
        <div class="balance-label">Total Entropy Generation</div>
        <div class="balance-value">${fmtPDF(entr.total_Sgen_W_per_K, 4)} <span style="font-size:9px;font-weight:400;color:#64748b;">W/K</span></div>
        <div style="font-size:8.5px;color:#94a3b8;margin-top:4px;font-family:monospace;">
          Lost work = T&#x2080;&middot;&Sigma;S&#775;_gen = ${lostWork} kW
        </div>
      </div>`);
    }
    if (exrg.total_exergy_destruction_kW != null) {
      win.document.write(`<div class="balance-card" style="border-left:3px solid #dc2626;">
        <div class="balance-label">Total Exergy Destruction</div>
        <div class="balance-value">${fmtPDF(exrg.total_exergy_destruction_kW, 3)} <span style="font-size:9px;font-weight:400;color:#64748b;">kW</span></div>
        <div style="font-size:8.5px;color:#94a3b8;margin-top:4px;font-family:monospace;">
          &eta;_exergy = ${pctPDF(exrg.exergy_efficiency)}
        </div>
      </div>`);
    }
    win.document.write(`</div>`);
  }
  win.document.write(`</div>`);

  // ── 5. Entropy Generation Breakdown ────────────────────────────────────────
  if (entr.component_breakdown?.length > 0) {
    const maxS = Math.max(...entr.component_breakdown.map((b: any) => b.share_pct ?? 0), 1);
    win.document.write(`<div class="section">
      <div class="section-title"><span class="icon">&#x1F321;&#xFE0F;</span> Entropy Generation Breakdown</div>
      <div style="font-size:8.5px;color:#7c3aed;font-family:monospace;margin-bottom:8px;padding:4px 8px;background:#faf5ff;border-radius:4px;border:1px solid #ede9fe;">
        S&#775;_gen,i = m&#775;&middot;(s_out &minus; s_in) &ge; 0 &nbsp;&middot;&nbsp; Gouy-Stodola: W&#775;_lost = T&#x2080;&middot;S&#775;_gen,total
      </div>`);
    entr.component_breakdown.forEach((b: any) => {
      const pctVal = (b.share_pct ?? 0);
      const barW   = ((pctVal / maxS) * 100).toFixed(1);
      win.document.write(`<div class="bar-row">
        <div class="bar-label">
          <span>${b.name ?? ''}</span>
          <span class="val">${fmtPDF(b.Sgen_W_per_K, 5)} W/K &nbsp; (${fmtPDF(pctVal, 1)}%)</span>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${barW}%;background:#7c3aed;opacity:0.75;"></div></div>
      </div>`);
    });
    win.document.write(`</div>`);
  }

  // ── 6. Exergy Destruction Breakdown ────────────────────────────────────────
  if (exrg.component_breakdown?.length > 0) {
    const maxE = Math.max(...exrg.component_breakdown.map((b: any) => b.exergy_destruction_share ?? 0), 1);
    win.document.write(`<div class="section">
      <div class="section-title"><span class="icon">&#x1F525;</span> Exergy Destruction Breakdown</div>
      <div style="font-size:8.5px;color:#dc2626;font-family:monospace;margin-bottom:8px;padding:4px 8px;background:#fff5f5;border-radius:4px;border:1px solid #fecaca;">
        E&#775;x_dest,i = T&#x2080;&middot;S&#775;_gen,i &nbsp;&middot;&nbsp; &eta;_ex = W&#775;_net / &Delta;E&#775;x_source = ${pctPDF(exrg.exergy_efficiency)}
      </div>`);
    exrg.component_breakdown.forEach((b: any) => {
      const pctVal = (b.exergy_destruction_share ?? 0);
      const barW   = ((pctVal / maxE) * 100).toFixed(1);
      win.document.write(`<div class="bar-row">
        <div class="bar-label">
          <span>${b.name ?? ''}</span>
          <span class="val">${fmtPDF(b.exergy_destruction_kW, 4)} kW &nbsp; (${fmtPDF(pctVal, 1)}%)</span>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${barW}%;background:#dc2626;opacity:0.7;"></div></div>
      </div>`);
    });
    win.document.write(`</div>`);
  }

  // ── 7. Analysis (Commentary) ────────────────────────────────────────────────
  if (comm.summary || comm.performance_insights?.length || comm.improvement_suggestions?.length) {
    win.document.write(`<div class="section">
      <div class="section-title"><span class="icon">&#x1F4AC;</span> Analysis</div>`);
    if (comm.summary)
      win.document.write(`<div class="comm-summary">${comm.summary}</div>`);
    if (comm.performance_insights?.length) {
      win.document.write(`<div class="comm-heading">Performance Insights</div>
        <ul class="comm-list">${comm.performance_insights.map((s: string) => `<li>${s}</li>`).join('')}</ul>`);
    }
    if (comm.improvement_suggestions?.length) {
      win.document.write(`<div class="comm-heading">Improvement Suggestions</div>
        <ul class="comm-list">${comm.improvement_suggestions.map((s: string) => `<li>${s}</li>`).join('')}</ul>`);
    }
    win.document.write(`</div>`);
  }

  // ── 8 + 9. Diagrams (T-s and P-h via SVG data URI) ─────────────────────────
  const hasTsD = results.ts_diagram && !results.ts_diagram.note;
  const hasPhD = results.ph_diagram && !results.ph_diagram.note;

  if (hasTsD || hasPhD) {
    win.document.write(`<div class="section">
      <div class="section-title"><span class="icon">&#x1F4C8;</span> Cycle Diagrams</div>
      <div class="diagram-grid">`);

    // Helper: build a static SVG diagram (no interactivity) for PDF
    const buildDiagramSVG = (
      cycleX: number[], cycleY: number[], labels: string[],
      satXLiq: number[], satXVap: number[], satY: number[],
      xLabel: string, yLabel: string, logY = false,
    ): string => {
      const VW = 460, VH = 280;
      const PAD = { l: 52, r: 16, t: 14, b: 38 };
      const iW = VW - PAD.l - PAD.r, iH = VH - PAD.t - PAD.b;

      const allX = [...cycleX, ...satXLiq, ...satXVap].filter(isFinite);
      const allY = [...cycleY, ...satY].filter(v => isFinite(v) && (!logY || v > 0));
      if (!allX.length || !allY.length) return '';

      const xMin = Math.min(...allX), xMax = Math.max(...allX);
      const yMin = Math.min(...allY), yMax = Math.max(...allY);
      const xSpan = xMax - xMin || 1, ySpan = yMax - yMin || 1;
      const xLo = xMin - xSpan * 0.07, xHi = xMax + xSpan * 0.07;
      const yLo = logY ? yMin * 0.65 : yMin - ySpan * 0.07;
      const yHi = logY ? yMax * 1.55 : yMax + ySpan * 0.07;
      const lyLo = logY ? Math.log10(Math.max(yLo, 1e-9)) : 0;
      const lyHi = logY ? Math.log10(yHi) : 0;

      const sx = (x: number) => PAD.l + ((x - xLo) / (xHi - xLo)) * iW;
      const sy = (y: number) => {
        if (logY) {
          const ly = Math.log10(Math.max(y, 1e-12));
          return PAD.t + iH - ((ly - lyLo) / (lyHi - lyLo)) * iH;
        }
        return PAD.t + iH - ((y - yLo) / (yHi - yLo)) * iH;
      };
      const pts = (xs: number[], ys: number[]) =>
        xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${sx(x).toFixed(1)},${sy(ys[i]).toFixed(1)}`).join(' ');

      let domeFill = '';
      if (satXLiq.length && satXVap.length && satY.length) {
        const fwd = satXLiq.map((x, i) => `${i === 0 ? 'M' : 'L'}${sx(x).toFixed(1)},${sy(satY[i]).toFixed(1)}`).join(' ');
        const rev = [...satXVap].reverse().map((x, i) => `L${sx(x).toFixed(1)},${sy(satY[satY.length - 1 - i]).toFixed(1)}`).join(' ');
        domeFill = `<path d="${fwd} ${rev} Z" fill="rgba(14,165,233,0.12)" />`;
      }

      const N = 4;
      const xTicks = Array.from({ length: N + 1 }, (_, i) => xLo + (xHi - xLo) * i / N);
      const yTicks = logY
        ? Array.from({ length: Math.floor(lyHi) - Math.ceil(lyLo) + 1 }, (_, i) => 10 ** (Math.ceil(lyLo) + i)).filter(v => v >= yLo && v <= yHi * 1.1)
        : Array.from({ length: N + 1 }, (_, i) => yLo + (yHi - yLo) * i / N);

      const fmtT = (v: number) => {
        const a = Math.abs(v);
        if (a >= 1e3) return `${(v / 1e3).toFixed(0)}k`;
        return v.toFixed(a < 10 ? 1 : 0);
      };

      const cyclePathStr = pts(cycleX, cycleY) + ' Z';
      const nodeCircles = cycleX.slice(0, -1).map((x, i) => {
        const cx = sx(x).toFixed(1), cy = sy(cycleY[i]).toFixed(1);
        const lbl = labels?.[i] ?? String(i + 1);
        const offX = parseFloat(cx) > VW * 0.8 ? -10 : 7;
        const offY = parseFloat(cy) < PAD.t + 18 ? 12 : -6;
        return `<circle cx="${cx}" cy="${cy}" r="4.5" fill="#1e293b" stroke="#0ea5e9" stroke-width="1.8"/>
          <text x="${(parseFloat(cx) + offX).toFixed(1)}" y="${(parseFloat(cy) + offY).toFixed(1)}"
            font-size="8.5" font-weight="700" fill="#e2e8f0" text-anchor="middle">${lbl}</text>`;
      }).join('');

      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VW} ${VH}" width="${VW}" height="${VH}"
          style="font-family:'Courier New',monospace;background:#0f172a;border-radius:8px;">
        <rect x="${PAD.l}" y="${PAD.t}" width="${iW}" height="${iH}" fill="rgba(15,23,42,0.95)"/>
        ${yTicks.map(v => `<line x1="${PAD.l}" y1="${sy(v).toFixed(1)}" x2="${VW - PAD.r}" y2="${sy(v).toFixed(1)}"
          stroke="rgba(51,65,85,0.6)" stroke-width="0.5" stroke-dasharray="3,4"/>`).join('')}
        ${xTicks.map(v => `<line x1="${sx(v).toFixed(1)}" y1="${PAD.t}" x2="${sx(v).toFixed(1)}" y2="${VH - PAD.b}"
          stroke="rgba(51,65,85,0.6)" stroke-width="0.5" stroke-dasharray="3,4"/>`).join('')}
        ${domeFill}
        ${satXLiq.length ? `<path d="${pts(satXLiq, satY)}" fill="none" stroke="#38bdf8" stroke-width="1.4" stroke-opacity="0.8"/>` : ''}
        ${satXVap.length ? `<path d="${pts(satXVap, satY)}" fill="none" stroke="#f97316" stroke-width="1.4" stroke-opacity="0.8"/>` : ''}
        <path d="${cyclePathStr}" fill="none" stroke="#0ea5e9" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        ${nodeCircles}
        ${yTicks.map(v => `<text x="${(PAD.l - 4).toFixed(0)}" y="${(sy(v) + 3).toFixed(1)}"
          font-size="7" fill="rgba(148,163,184,0.9)" text-anchor="end">${fmtT(v)}</text>`).join('')}
        ${xTicks.map(v => `<text x="${sx(v).toFixed(1)}" y="${(VH - PAD.b + 12).toFixed(1)}"
          font-size="7" fill="rgba(148,163,184,0.9)" text-anchor="middle">${fmtT(v)}</text>`).join('')}
        <text x="${(VW / 2).toFixed(0)}" y="${(VH - 4).toFixed(0)}" font-size="8" fill="rgba(148,163,184,0.7)"
          text-anchor="middle">${xLabel}</text>
        <text x="11" y="${(PAD.t + iH / 2).toFixed(0)}" font-size="8" fill="rgba(148,163,184,0.7)"
          text-anchor="middle" transform="rotate(-90,11,${(PAD.t + iH / 2).toFixed(0)})">${yLabel}</text>
        <rect x="${PAD.l}" y="${PAD.t}" width="${iW}" height="${iH}" fill="none"
          stroke="rgba(51,65,85,0.8)" stroke-width="0.8"/>
      </svg>`;
    };

    if (hasTsD) {
      const tsd = results.ts_diagram;
      const svg = buildDiagramSVG(
        tsd.cycle?.s?.map((v: number) => v / 1000) ?? [],
        tsd.cycle?.T ?? [],
        tsd.cycle?.labels ?? [],
        tsd.saturation?.s_liq?.map((v: number) => v / 1000) ?? [],
        tsd.saturation?.s_vap?.map((v: number) => v / 1000) ?? [],
        tsd.saturation?.T ?? [],
        's [kJ/(kg K)]', 'T [K]',
      );
      if (svg) {
        const b64 = btoa(unescape(encodeURIComponent(svg)));
        win.document.write(`<div class="diagram-box">
          <img src="data:image/svg+xml;base64,${b64}" alt="T-s Diagram"/>
          <div class="diagram-label">T-s Diagram</div>
        </div>`);
      }
    }

    if (hasPhD) {
      const phd = results.ph_diagram;
      const svg = buildDiagramSVG(
        phd.cycle?.h?.map((v: number) => v / 1000) ?? [],
        phd.cycle?.P?.map((v: number) => v / 1000) ?? [],
        phd.cycle?.labels ?? [],
        phd.saturation?.h_liq?.map((v: number) => v / 1000) ?? [],
        phd.saturation?.h_vap?.map((v: number) => v / 1000) ?? [],
        phd.saturation?.P?.map((v: number) => v / 1000) ?? [],
        'h [kJ/kg]', 'P [kPa]', true,
      );
      if (svg) {
        const b64 = btoa(unescape(encodeURIComponent(svg)));
        win.document.write(`<div class="diagram-box">
          <img src="data:image/svg+xml;base64,${b64}" alt="P-h Diagram"/>
          <div class="diagram-label">P-h Diagram</div>
        </div>`);
      }
    }

    win.document.write(`</div></div>`);
  }

  // ── Footer ──────────────────────────────────────────────────────────────────
  win.document.write(`
  <div class="footer">
    <span>ThermoBird &mdash; Quanta Labs</span>
    <span>${simName} &nbsp;&middot;&nbsp; ${fluid}</span>
    <span>${now}</span>
  </div>`);

  pdfClose(win);
}

// ─────────────────────────────────────────────────────────────────────────────
// Solver PDF  — variables + steps report
// ─────────────────────────────────────────────────────────────────────────────

export function exportSolverPDF(
  results: { success: boolean; variables: Record<string, any>; steps: any[]; errors: string[]; execution_time_ms: number },
  scriptName = 'Solver Script',
) {
  const win = pdfOpen(`${scriptName} — ThermoBird Solver Report`);
  if (!win) return;
  const now = new Date().toLocaleString();

  win.document.write(`
  <div class="report-header">
    <div>
      <div class="report-title">&#x1F426; ThermoBird &mdash; Solver Report</div>
      <div class="report-subtitle">${scriptName}</div>
      <div class="report-subtitle">Generated: ${now}</div>
    </div>
    <div style="text-align:right">
      <div class="report-badge" style="background:${results.success ? '#16a34a' : '#dc2626'}">
        ${results.success ? 'SOLVED' : 'ERRORS'}
      </div>
      <div style="font-size:9px;color:#94a3b8;margin-top:6px;">
        ${Object.keys(results.variables).length} variables &nbsp;&middot;&nbsp;
        ${results.execution_time_ms.toFixed(1)} ms
      </div>
    </div>
  </div>`);

  // ── Numeric variables ──
  const numVars = Object.entries(results.variables).filter(([, v]) => typeof v === 'number');
  if (numVars.length > 0) {
    win.document.write(`<div class="section">
      <div class="section-title"><span class="icon">&#x1F522;</span> Numeric Variables (${numVars.length})</div>
      <table>
        <thead><tr><th>Variable</th><th>Value</th></tr></thead>
        <tbody>`);
    numVars.forEach(([k, v]) => {
      win.document.write(`<tr>
        <td class="accent">${k}</td>
        <td>${fmtPDF(v as number, 6)}</td>
      </tr>`);
    });
    win.document.write(`</tbody></table></div>`);
  }

  // ── String variables ──
  const strVars = Object.entries(results.variables).filter(([, v]) => typeof v === 'string');
  if (strVars.length > 0) {
    win.document.write(`<div class="section">
      <div class="section-title"><span class="icon">&#x1F4DD;</span> String Variables (${strVars.length})</div>
      <table>
        <thead><tr><th>Variable</th><th>Value</th></tr></thead>
        <tbody>`);
    strVars.forEach(([k, v]) => {
      win.document.write(`<tr><td class="accent">${k}</td><td>${v}</td></tr>`);
    });
    win.document.write(`</tbody></table></div>`);
  }

  // ── Errors ──
  if (results.errors.length > 0) {
    win.document.write(`<div class="section">
      <div class="section-title" style="color:#dc2626;"><span class="icon">&#x26A0;</span> Errors</div>`);
    results.errors.forEach(e => {
      win.document.write(`<div style="font-size:10px;padding:5px 9px;background:#fff5f5;border-left:3px solid #dc2626;
        border-radius:0 4px 4px 0;margin-bottom:4px;color:#dc2626;font-family:monospace;">${e}</div>`);
    });
    win.document.write(`</div>`);
  }

  win.document.write(`
  <div class="footer">
    <span>ThermoBird &mdash; Equation Solver</span>
    <span>${scriptName}</span>
    <span>${now}</span>
  </div>`);

  pdfClose(win);
}
