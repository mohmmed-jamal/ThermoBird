/**
 * unitSystemStore — global SI ↔ Imperial toggle
 * Consumed by any component that needs unit-aware display.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type UnitSystem = 'SI' | 'Imperial';

interface UnitSystemState {
  unitSystem: UnitSystem;
  toggle: () => void;
  set: (s: UnitSystem) => void;
}

export const useUnitSystemStore = create<UnitSystemState>()(
  persist(
    (set, get) => ({
      unitSystem: 'SI',
      toggle: () => set({ unitSystem: get().unitSystem === 'SI' ? 'Imperial' : 'SI' }),
      set:    (s) => set({ unitSystem: s }),
    }),
    { name: 'tb-unit-system' }
  )
);

// ── Conversion helpers ────────────────────────────────────────────────────────
// All values stored / computed in SI. These convert for display only.

export type UnitKey = 'T' | 'P' | 'H' | 'S' | 'U' | 'D' | 'V' | 'mdot' | 'W' | 'Q_flow';

const SI_LABEL: Record<UnitKey, string> = {
  T:      'K',
  P:      'kPa',
  H:      'kJ/kg',
  S:      'kJ/(kg·K)',
  U:      'kJ/kg',
  D:      'kg/m³',
  V:      'm³/kg',
  mdot:   'kg/s',
  W:      'kW',
  Q_flow: 'kW',
};

const IMP_LABEL: Record<UnitKey, string> = {
  T:      '°F',
  P:      'psi',
  H:      'Btu/lb',
  S:      'Btu/(lb·R)',
  U:      'Btu/lb',
  D:      'lb/ft³',
  V:      'ft³/lb',
  mdot:   'lb/s',
  W:      'Btu/hr',
  Q_flow: 'Btu/hr',
};

// SI → Imperial conversion functions
const TO_IMP: Record<UnitKey, (v: number) => number> = {
  T:      v => (v - 273.15) * 9 / 5 + 32,     // K  → °F
  P:      v => v * 0.145038,                    // kPa → psi
  H:      v => v * 0.429923,                    // kJ/kg → Btu/lb
  S:      v => v * 0.238846,                    // kJ/(kg·K) → Btu/(lb·R)
  U:      v => v * 0.429923,
  D:      v => v * 0.062428,                    // kg/m³ → lb/ft³
  V:      v => v * 16.0185,                     // m³/kg → ft³/lb
  mdot:   v => v * 2.20462,                     // kg/s → lb/s
  W:      v => v * 3412.14,                     // kW → Btu/hr
  Q_flow: v => v * 3412.14,
};

export function convertValue(val: number, key: UnitKey, sys: UnitSystem): number {
  if (sys === 'SI') return val;
  return TO_IMP[key](val);
}

export function unitLabel(key: UnitKey, sys: UnitSystem): string {
  return sys === 'SI' ? SI_LABEL[key] : IMP_LABEL[key];
}

export function fmtVal(val: number, key: UnitKey, sys: UnitSystem, dp = 2): string {
  const v = convertValue(val, key, sys);
  if (!isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a < 1e-3 || a > 1e9) return v.toExponential(3);
  if (dp != null) return v.toFixed(dp);
  if (a < 10) return v.toFixed(4);
  if (a < 1000) return v.toFixed(2);
  return v.toFixed(1);
}
