/**
 * units.ts — ThermoBird unit conversion helpers
 *
 * TWO UNIT CONTEXTS:
 *
 * 1. CANVAS / cycle-engine results — backend returns raw SI:
 *      Pressure  → Pa        display as  kPa   (÷ 1000)
 *      Enthalpy  → J/kg      display as  kJ/kg (÷ 1000)
 *      Entropy   → J/(kg·K)  display as  kJ/(kg·K) (÷ 1000)
 *      Int. energy → J/kg    display as  kJ/kg (÷ 1000)
 *      Work/Heat → J/kg      display as  kJ/kg (÷ 1000)
 *    → use  fmtWithUnit()  /  applyUnit()
 *
 * 2. SOLVER (TBS equation solver) — backend already returns display units:
 *      Pressure  → kPa       (no conversion needed)
 *      Enthalpy  → kJ/kg     (no conversion needed)
 *      Entropy   → kJ/(kg·K) (no conversion needed)
 *      Temperature → K       (no conversion needed)
 *    → use  fmtWithUnitSolver()  /  applyUnitSolver()
 *
 * Variable name heuristics (case-insensitive prefixes/substrings):
 *   P*, *pressure*, *_p*, *p_*  → kPa
 *   h*, *enthalpy*, *_h, h_*    → kJ/kg
 *   s*, *entropy*, *_s, s_*     → kJ/(kg·K)
 *   u*, *internal*              → kJ/kg
 *   W_*, Q_*, work, heat, *_w, *_q  → kJ/kg
 *   T*, *temp*, *_t, t_*        → K
 *   eta*, eff*, cop*            → – (dimensionless, no conversion)
 */

type UnitInfo = { factor: number; display: string };

// ── Name-based heuristics ──────────────────────────────────────────────────
function classifyVariable(name: string): UnitInfo {
  const n = name.toLowerCase();

  // Dimensionless — must check first to avoid matching 'p' in 'cop'
  if (/^(eta|eff|cop|cof|x|quality|pr|z)/.test(n) || n === 'quality') {
    return { factor: 1, display: '' };
  }

  // Pressure: starts with p or contains pressure/pres
  if (/^p[\W_]?/.test(n) || /pressure|_pres/.test(n)) {
    return { factor: 1e-3, display: 'kPa' };
  }

  // Temperature
  if (/^t[\W_]?/.test(n) || /temp|_t$|^t$/.test(n)) {
    return { factor: 1, display: 'K' };
  }

  // Entropy
  if (/^s[\W_]?/.test(n) || /entropy|_s$|^s$/.test(n)) {
    return { factor: 1e-3, display: 'kJ/(kg·K)' };
  }

  // Enthalpy
  if (/^h[\W_]?/.test(n) || /enthalpy|_h$|^h$/.test(n)) {
    return { factor: 1e-3, display: 'kJ/kg' };
  }

  // Internal energy
  if (/^u[\W_]?/.test(n) || /internal/.test(n)) {
    return { factor: 1e-3, display: 'kJ/kg' };
  }

  // Work or Heat (W_*, Q_*, w_net, q_in, etc.)
  if (/^[wq][\W_]/.test(n) || /^[wq]$/.test(n) || /work|heat/.test(n)) {
    return { factor: 1e-3, display: 'kJ/kg' };
  }

  // Specific volume / density — keep SI
  if (/^v[\W_]?/.test(n) || /volume|density|^d[\W_]?/.test(n)) {
    return { factor: 1, display: 'm³/kg' };
  }

  // Mass flow
  if (/flow|mdot|mass/.test(n)) {
    return { factor: 1, display: 'kg/s' };
  }

  // Default: no conversion, no unit label
  return { factor: 1, display: '' };
}

/** Return the display unit label for a variable name */
export function inferDisplayUnit(name: string): string {
  return classifyVariable(name).display;
}

/** Convert a raw SI value to display units */
export function applyUnit(name: string, value: number): number {
  const info = classifyVariable(name);
  return value * info.factor;
}

/** Format a raw SI value as a display string with appropriate precision */
function fmtNumber(v: number): string {
  if (!isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a < 1e-3 || a > 1e9) return v.toExponential(3);
  if (a < 10)  return v.toFixed(4);
  if (a < 1000) return v.toFixed(2);
  return v.toFixed(1);
}

/** Return { text, unit } for display — converts SI → display units */
export function fmtWithUnit(name: string, rawSI: number | null): { text: string; unit: string } {
  if (rawSI === null || rawSI === undefined) return { text: '—', unit: '' };
  const info = classifyVariable(name);
  return { text: fmtNumber(rawSI * info.factor), unit: info.display };
}

// ── Solver-context helpers (TBS already returns kPa / kJ / K) ─────────────
// The equation solver backend auto-converts CoolProp output to display units,
// so no factor multiplication is needed — we just attach the correct label.

function classifyVariableSolver(name: string): UnitInfo {
  const n = name.toLowerCase();
  // Dimensionless — must check first
  if (/^(eta|eff|cop|cof|x|quality|pr|z)/.test(n) || n === 'quality') {
    return { factor: 1, display: '' };
  }
  if (/^p[\W_]?/.test(n) || /pressure|_pres/.test(n)) return { factor: 1, display: 'kPa' };
  if (/^t[\W_]?/.test(n) || /temp|_t$|^t$/.test(n))  return { factor: 1, display: 'K' };
  if (/^s[\W_]?/.test(n) || /entropy|_s$|^s$/.test(n)) return { factor: 1, display: 'kJ/(kg·K)' };
  if (/^h[\W_]?/.test(n) || /enthalpy|_h$|^h$/.test(n)) return { factor: 1, display: 'kJ/kg' };
  if (/^u[\W_]?/.test(n) || /internal/.test(n))        return { factor: 1, display: 'kJ/kg' };
  if (/^[wq][\W_]/.test(n) || /^[wq]$/.test(n) || /work|heat/.test(n)) return { factor: 1, display: 'kJ/kg' };
  if (/^v[\W_]?/.test(n) || /volume|density|^d[\W_]?/.test(n)) return { factor: 1, display: 'm³/kg' };
  if (/flow|mdot|mass/.test(n)) return { factor: 1, display: 'kg/s' };
  return { factor: 1, display: '' };
}

/** Display unit label for a solver variable name */
export function inferDisplayUnitSolver(name: string): string {
  return classifyVariableSolver(name).display;
}

/** Format a solver result value (already in kPa/kJ) with its unit label */
export function fmtWithUnitSolver(name: string, value: number | null): { text: string; unit: string } {
  if (value === null || value === undefined) return { text: '—', unit: '' };
  const info = classifyVariableSolver(name);
  return { text: fmtNumber(value * info.factor), unit: info.display };
}
