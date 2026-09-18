/**
 * propertyCalculatorStore — persists PropertyCalculator state across tab switches.
 * Lives as a simple Zustand store (no localStorage — in-session memory is enough).
 */
import { create } from 'zustand';

export type UnitSys = 'SI' | 'Imperial';

export interface PropertyCalcState {
  fluid:    string;
  pairIdx:  number;
  val1:     string;
  val2:     string;
  sys:      UnitSys;
  result:   any | null;
  error:    string;

  setFluid:   (f: string)  => void;
  setPairIdx: (i: number)  => void;
  setVal1:    (v: string)  => void;
  setVal2:    (v: string)  => void;
  setSys:     (s: UnitSys) => void;
  setResult:  (r: any)     => void;
  setError:   (e: string)  => void;
  reset:      ()           => void;
}

const INIT = {
  fluid:   'Water',
  pairIdx: 0,
  val1:    '101325',
  val2:    '373.15',
  sys:     'SI' as UnitSys,
  result:  null,
  error:   '',
};

export const usePropertyCalcStore = create<PropertyCalcState>((set) => ({
  ...INIT,
  setFluid:   (fluid)   => set({ fluid,   result: null, error: '' }),
  setPairIdx: (pairIdx) => set({ pairIdx }),
  setVal1:    (val1)    => set({ val1 }),
  setVal2:    (val2)    => set({ val2 }),
  setSys:     (sys)     => set({ sys }),
  setResult:  (result)  => set({ result, error: '' }),
  setError:   (error)   => set({ error,  result: null }),
  reset:      ()        => set({ ...INIT }),
}));
