/**
 * parametricStore — persists ParametricAnalysis tab state across tab switches.
 */
import { create } from 'zustand';
import type { ParametricRunResponse } from '../lib/api';

export interface SweepVarDraft {
  id:     string;
  name:   string;
  label:  string;
  mode:   'range' | 'list';
  min:    string;
  max:    string;
  steps:  string;
  values: string;
}

export type SourceType = 'solver' | 'canvas';

const blankVar = (): SweepVarDraft => ({
  id:     `v_${Date.now()}_0`,
  name:   '',
  label:  '',
  mode:   'range',
  min:    '',
  max:    '',
  steps:  '10',
  values: '',
});

interface ParametricState {
  sourceType:     SourceType;
  studyName:      string;
  sweepVar:       SweepVarDraft;          // single sweep variable
  selectedOutputs: string[];              // empty = auto-detect all
  genPlots:       boolean;
  saveStudy:      boolean;
  result:         ParametricRunResponse | null;

  setSourceType:      (t: SourceType) => void;
  setStudyName:       (n: string) => void;
  setSweepVar:        (v: SweepVarDraft) => void;
  setSelectedOutputs: (o: string[]) => void;
  setGenPlots:        (b: boolean) => void;
  setSaveStudy:       (b: boolean) => void;
  setResult:          (r: ParametricRunResponse | null) => void;
  reset:              () => void;
}

const INIT = {
  sourceType:      'solver' as SourceType,
  studyName:       'Parametric Study',
  sweepVar:        blankVar(),
  selectedOutputs: [] as string[],
  genPlots:        true,
  saveStudy:       true,
  result:          null,
};

export const useParametricStore = create<ParametricState>((set) => ({
  ...INIT,
  setSourceType:      (sourceType)      => set({ sourceType }),
  setStudyName:       (studyName)       => set({ studyName }),
  setSweepVar:        (sweepVar)        => set({ sweepVar }),
  setSelectedOutputs: (selectedOutputs) => set({ selectedOutputs }),
  setGenPlots:        (genPlots)        => set({ genPlots }),
  setSaveStudy:       (saveStudy)       => set({ saveStudy }),
  setResult:          (result)          => set({ result }),
  reset:              ()                => set({ ...INIT, sweepVar: blankVar() }),
}));
