/**
 * validateCanvas — frontend pre-run validation
 *
 * Runs entirely in the browser before any API call is made.
 * Returns a list of ValidationIssue objects; an empty array means the canvas
 * is ready to run.
 *
 * Each issue carries:
 *   - componentId  → so the canvas can highlight the offending card
 *   - severity     → 'error' blocks the run; 'warning' allows it but surfaces advice
 *   - field        → the parameter key that is missing/invalid (optional)
 *   - message      → human-readable explanation
 */

import type { CanvasComponent, CanvasConnection } from '../store/cycleStore';
import { componentLibrary } from './componentLibrary';

// ─────────────────────────────────────────────────────────────────────────────

export type IssueSeverity = 'error' | 'warning';

export interface ValidationIssue {
  componentId: string;
  severity:    IssueSeverity;
  message:     string;
  field?:      string;
}

export interface ValidationResult {
  ok:       boolean;          // true when zero errors (warnings don't block)
  errors:   ValidationIssue[];
  warnings: ValidationIssue[];
  all:      ValidationIssue[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Required-parameter rules per component type
// A "required" param must be present AND a finite positive number.
// ─────────────────────────────────────────────────────────────────────────────

type ParamRule = { key: string; label: string; mustBePositive?: boolean };

const REQUIRED_PARAMS: Record<string, ParamRule[]> = {
  turbine:         [{ key: 'eta_isentropic', label: 'Isentropic Efficiency', mustBePositive: true }],
  pump:            [{ key: 'eta_isentropic', label: 'Isentropic Efficiency', mustBePositive: true }],
  compressor:      [
    { key: 'eta_isentropic', label: 'Isentropic Efficiency', mustBePositive: true },
    { key: 'pressure_ratio', label: 'Pressure Ratio',        mustBePositive: true },
  ],
  boiler:          [{ key: 'outlet_P', label: 'Operating Pressure', mustBePositive: true }],
  condenser:       [],
  evaporator:      [],
  heat_exchanger:  [{ key: 'effectiveness', label: 'Effectiveness ε', mustBePositive: true }],
  regenerator:     [{ key: 'effectiveness', label: 'Effectiveness ε', mustBePositive: true }],
  expansion_valve: [],
  mixing_chamber:  [],
};

// Parameters that, when provided, must fall within a specific range
const RANGE_RULES: Record<string, { key: string; label: string; min: number; max: number }[]> = {
  turbine:        [{ key: 'eta_isentropic', label: 'Isentropic Efficiency', min: 0.1, max: 1.0 }],
  pump:           [{ key: 'eta_isentropic', label: 'Isentropic Efficiency', min: 0.1, max: 1.0 }],
  compressor:     [{ key: 'eta_isentropic', label: 'Isentropic Efficiency', min: 0.1, max: 1.0 }],
  heat_exchanger: [{ key: 'effectiveness', label: 'Effectiveness ε',       min: 0.01, max: 1.0 }],
  regenerator:    [{ key: 'effectiveness', label: 'Effectiveness ε',       min: 0.01, max: 1.0 }],
};

// ─────────────────────────────────────────────────────────────────────────────

function isValidPositiveNumber(v: any): boolean {
  return v != null && typeof v === 'number' && isFinite(v) && v > 0;
}

function isValidNumber(v: any): boolean {
  return v != null && typeof v === 'number' && isFinite(v);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main validator
// ─────────────────────────────────────────────────────────────────────────────

export function validateCanvas(
  components: CanvasComponent[],
  connections: CanvasConnection[],
): ValidationResult {
  const issues: ValidationIssue[] = [];

  const push = (issue: ValidationIssue) => issues.push(issue);

  // ── 1. Minimum topology ────────────────────────────────────────────────────
  // We don't associate topology errors with a single component — use a sentinel
  const GLOBAL = '__global__';

  if (components.length < 2) {
    push({ componentId: GLOBAL, severity: 'error',
      message: 'A cycle needs at least 2 components.' });
  }
  if (connections.length < 2) {
    push({ componentId: GLOBAL, severity: 'error',
      message: 'Connect the components to form a closed cycle.' });
  }

  // ── 2. Per-component checks ────────────────────────────────────────────────
  // Build lookup: which ports of each component are connected?
  const connectedPorts = new Map<string, Set<string>>(); // componentId → Set<port>
  for (const conn of connections) {
    if (!connectedPorts.has(conn.from)) connectedPorts.set(conn.from, new Set());
    if (!connectedPorts.has(conn.to))   connectedPorts.set(conn.to,   new Set());
    connectedPorts.get(conn.from)!.add(conn.fromPort);
    connectedPorts.get(conn.to)!.add(conn.toPort);
  }

  for (const comp of components) {
    const config      = componentLibrary[comp.type];
    const params      = comp.parameters ?? {};
    const connected   = connectedPorts.get(comp.id) ?? new Set<string>();

    // ── 2a. Unconnected ports ─────────────────────────────────────────────
    if (config) {
      for (const port of config.ports) {
        if (!connected.has(port)) {
          push({
            componentId: comp.id,
            severity: 'error',
            message: `Port "${port.replace(/_/g, ' ')}" is not connected.`,
            field: port,
          });
        }
      }
    }

    // ── 2b. Required parameters ────────────────────────────────────────────
    const requiredRules = REQUIRED_PARAMS[comp.type] ?? [];
    for (const rule of requiredRules) {
      const val = params[rule.key];
      // Only fail if the library also declares a defaultParam;
      // if there's a default, the engine will use it even if not set.
      const hasDefault = config?.defaultParams[rule.key] != null;
      if (!hasDefault && !isValidNumber(val)) {
        push({
          componentId: comp.id,
          severity: 'error',
          message: `${rule.label} is required.`,
          field: rule.key,
        });
      } else if (rule.mustBePositive) {
        const effective = isValidNumber(val) ? val : config?.defaultParams[rule.key];
        if (!isValidPositiveNumber(effective)) {
          push({
            componentId: comp.id,
            severity: 'error',
            message: `${rule.label} must be a positive number.`,
            field: rule.key,
          });
        }
      }
    }

    // ── 2c. Range checks ──────────────────────────────────────────────────
    const rangeRules = RANGE_RULES[comp.type] ?? [];
    for (const rule of rangeRules) {
      const raw = params[rule.key];
      const val = isValidNumber(raw) ? raw : config?.defaultParams[rule.key];
      if (isValidNumber(val) && (val < rule.min || val > rule.max)) {
        push({
          componentId: comp.id,
          severity: 'error',
          message: `${rule.label} must be between ${rule.min} and ${rule.max} (got ${Number(val).toFixed(3)}).`,
          field: rule.key,
        });
      }
    }

    // ── 2d. Pressure sanity (boiler vs condenser / pump outlet) ───────────
    // Warn if boiler pressure ≤ condenser pressure when both are explicitly set.
    // This is a warning not a hard error because the engine will catch it too,
    // but we surface it early with a better message.
  }

  // ── 3. Cross-component pressure ordering ──────────────────────────────────
  const boilerP    = _findParam(components, ['boiler'],    'outlet_P');
  const condenserP = _findParam(components, ['condenser'], 'outlet_P');
  const turbineInP = _findParam(components, ['turbine'],   'inlet_P');
  const turbineExP = _findParam(components, ['turbine'],   'outlet_P');
  const pumpInP    = _findParam(components, ['pump'],      'inlet_P');
  const pumpOutP   = _findParam(components, ['pump'],      'outlet_P');

  if (boilerP != null && condenserP != null && boilerP <= condenserP) {
    const boiler = components.find(c => ['boiler'].includes(c.type))!;
    push({
      componentId: boiler.id,
      severity: 'error',
      message: `Boiler pressure (${fmtP(boilerP)}) must be greater than condenser pressure (${fmtP(condenserP)}).`,
      field: 'outlet_P',
    });
  }

  if (turbineInP != null && turbineExP != null && turbineInP <= turbineExP) {
    const turbine = components.find(c => c.type === 'turbine')!;
    push({
      componentId: turbine.id,
      severity: 'error',
      message: `Turbine inlet pressure (${fmtP(turbineInP)}) must exceed outlet pressure (${fmtP(turbineExP)}).`,
      field: 'inlet_P',
    });
  }

  if (pumpOutP != null && pumpInP != null && pumpOutP <= pumpInP) {
    const pump = components.find(c => c.type === 'pump')!;
    push({
      componentId: pump.id,
      severity: 'error',
      message: `Pump outlet pressure (${fmtP(pumpOutP)}) must exceed inlet pressure (${fmtP(pumpInP)}).`,
      field: 'outlet_P',
    });
  }

  // ── 4. Cycle closure ───────────────────────────────────────────────────────
  // Every component must have at least one incoming AND one outgoing connection.
  for (const comp of components) {
    const hasIn  = connections.some(c => c.to   === comp.id);
    const hasOut = connections.some(c => c.from === comp.id);
    if (!hasIn && !hasOut) {
      // Already caught by the "unconnected ports" check above — skip duplicates
    } else if (!hasIn) {
      // Isolated source — only warn if not already flagged by port check
      const alreadyFlagged = issues.some(i => i.componentId === comp.id);
      if (!alreadyFlagged) {
        push({
          componentId: comp.id,
          severity: 'warning',
          message: `${comp.name} has no incoming connections — cycle may be open.`,
        });
      }
    } else if (!hasOut) {
      const alreadyFlagged = issues.some(i => i.componentId === comp.id);
      if (!alreadyFlagged) {
        push({
          componentId: comp.id,
          severity: 'warning',
          message: `${comp.name} has no outgoing connections — cycle may be open.`,
        });
      }
    }
  }

  // ── 5. Duplicate connections ───────────────────────────────────────────────
  const portUsage = new Map<string, string>(); // "compId:port" → connId
  for (const conn of connections) {
    const fromKey = `${conn.from}:${conn.fromPort}`;
    const toKey   = `${conn.to}:${conn.toPort}`;
    for (const [key, id] of [[fromKey, conn.id], [toKey, conn.id]] as [string, string][]) {
      if (portUsage.has(key)) {
        const [cid] = key.split(':');
        push({
          componentId: cid,
          severity: 'error',
          message: `Port "${key.split(':')[1].replace(/_/g, ' ')}" has more than one connection.`,
          field: key.split(':')[1],
        });
      } else {
        portUsage.set(key, id);
      }
    }
  }

  const errors   = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    all: issues,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function _findParam(
  components: CanvasComponent[],
  types: string[],
  key: string,
): number | null {
  for (const comp of components) {
    if (types.includes(comp.type)) {
      const v = comp.parameters?.[key];
      if (v != null && isFinite(Number(v))) return Number(v);
    }
  }
  return null;
}

function fmtP(pa: number): string {
  return pa >= 1_000_000
    ? `${(pa / 1_000_000).toFixed(2)} MPa`
    : `${(pa / 1_000).toFixed(1)} kPa`;
}
