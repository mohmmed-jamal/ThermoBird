/**
 * ThermoBird — Mode Management Store
 * 
 * Two modes:
 * - EDUCATIONAL: Free tier with guided learning, hints, scaffolding
 * - PROFESSIONAL: Full access to all features, advanced solvers, scripting
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AppMode = 'educational' | 'professional';

export type EducationalTier = 'free' | 'premium';

export interface FeatureAccess {
  // Core features
  propertyCalculator: boolean;
  equationSolver: boolean;
  canvas: boolean;
  steadyStateCycles: boolean;
  
  // Transient analysis
  transientBasic: boolean;
  transientAdvanced: boolean;
  transientRealTime: boolean;
  
  // Solvers
  solverRK45: boolean;
  solverRadau: boolean;
  solverBDF: boolean;
  solverLSODA: boolean;
  solverAuto: boolean;
  
  // Educational features
  guidedTutorials: boolean;
  hints: boolean;
  progressTracking: boolean;
  conceptCheckpoints: boolean;
  
  // Professional features
  tbsScripting: boolean;
  parametricStudies: boolean;
  customFluids: boolean;
  exportPDF: boolean;
  exportMATLAB: boolean;
  apiAccess: boolean;
  
  // Component limits
  maxComponents: number;
  maxFluids: number;
}

const EDUCATIONAL_FREE_ACCESS: FeatureAccess = {
  // Free tier: property calc + equation solver only
  propertyCalculator: true,
  equationSolver: true,
  canvas: false,
  steadyStateCycles: false,

  transientBasic: false,
  transientAdvanced: false,
  transientRealTime: false,

  solverRK45: true,
  solverRadau: false,
  solverBDF: false,
  solverLSODA: false,
  solverAuto: false,

  guidedTutorials: true,
  hints: true,
  progressTracking: true,
  conceptCheckpoints: true,

  tbsScripting: false,
  parametricStudies: false,
  customFluids: false,
  exportPDF: false,
  exportMATLAB: false,
  apiAccess: false,

  maxComponents: 0,
  maxFluids: 10,
};

const EDUCATIONAL_PREMIUM_ACCESS: FeatureAccess = {
  // Premium tier: adds canvas + parametric
  propertyCalculator: true,
  equationSolver: true,
  canvas: true,
  steadyStateCycles: true,

  transientBasic: false,
  transientAdvanced: false,
  transientRealTime: false,

  solverRK45: true,
  solverRadau: true,
  solverBDF: false,
  solverLSODA: true,
  solverAuto: true,

  guidedTutorials: true,
  hints: true,
  progressTracking: true,
  conceptCheckpoints: true,

  tbsScripting: true,
  parametricStudies: true,
  customFluids: false,
  exportPDF: true,
  exportMATLAB: false,
  apiAccess: false,

  maxComponents: 8,
  maxFluids: 50,
};

const PROFESSIONAL_ACCESS: FeatureAccess = {
  propertyCalculator: true,
  equationSolver: true,
  canvas: true,
  steadyStateCycles: true,
  
  transientBasic: true,
  transientAdvanced: true,
  transientRealTime: true,
  
  solverRK45: true,
  solverRadau: true,
  solverBDF: true,
  solverLSODA: true,
  solverAuto: true,
  
  guidedTutorials: false, // Pro users don't need scaffolding
  hints: false,
  progressTracking: false,
  conceptCheckpoints: false,
  
  tbsScripting: true,
  parametricStudies: true,
  customFluids: true,
  exportPDF: true,
  exportMATLAB: true,
  apiAccess: true,
  
  maxComponents: Infinity,
  maxFluids: Infinity,
};

interface ModeState {
  mode: AppMode;
  educationalTier: EducationalTier;

  setMode: (mode: AppMode) => void;
  setEducationalTier: (tier: EducationalTier) => void;
  toggleMode: () => void;
  canAccess: (feature: keyof FeatureAccess) => boolean | number;
}

function getAccess(mode: AppMode, tier: EducationalTier): FeatureAccess {
  if (mode === 'professional') return PROFESSIONAL_ACCESS;
  if (tier === 'premium')      return EDUCATIONAL_PREMIUM_ACCESS;
  return EDUCATIONAL_FREE_ACCESS;
}

export const useModeStore = create<ModeState>()(
  persist(
    (set, get) => ({
      mode:            'educational' as AppMode,
      educationalTier: 'free'        as EducationalTier,

      setMode:             (mode) => set({ mode }),
      setEducationalTier:  (tier) => set({ educationalTier: tier }),
      toggleMode:          ()     => set((s) => ({
        mode: s.mode === 'educational' ? 'professional' : 'educational',
      })),

      canAccess: (feature) => {
        const { mode, educationalTier } = get();
        const val = getAccess(mode, educationalTier)[feature];
        return typeof val === 'boolean' ? val : (val as number);
      },
    }),
    {
      name: 'thermobird-mode',
      partialize: (state) => ({
        mode:            state.mode,
        educationalTier: state.educationalTier,
      }),
    }
  )
);

// ── Convenience selectors (use these in components) ───────────────────────────
export function useIsEducational()  { return useModeStore(s => s.mode === 'educational'); }
export function useIsProfessional() { return useModeStore(s => s.mode === 'professional'); }
export function useAccess(): FeatureAccess {
  return useModeStore(s => getAccess(s.mode, s.educationalTier));
}
export function useFeatureAccess(feature: keyof FeatureAccess): boolean {
  return useModeStore(s => {
    const val = getAccess(s.mode, s.educationalTier)[feature];
    return typeof val === 'boolean' ? val : val > 0;
  });
}
