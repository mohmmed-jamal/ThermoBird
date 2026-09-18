/**
 * ThermoBird — Mode Switcher Component
 * 
 * Allows users to toggle between Educational and Professional modes.
 * Educational mode includes learning scaffolding and guidance.
 * Professional mode provides full access without educational overlays.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { GraduationCap, Briefcase, Crown, X } from 'lucide-react';
import { useModeStore } from '../../store/modeStore';
import { useState } from 'react';

export function ModeSwitcher() {
  const mode           = useModeStore(s => s.mode);
  const educationalTier= useModeStore(s => s.educationalTier);
  const setMode        = useModeStore(s => s.setMode);
  const setEducationalTier = useModeStore(s => s.setEducationalTier);

  const [showDetails, setShowDetails] = useState(false);
  const isEdu = mode === 'educational';

  return (
    <div className="relative">
      {/* Mode Toggle Button */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200"
        style={{
          background: isEdu
            ? 'rgba(16, 185, 129, 0.15)'
            : 'rgba(245, 158, 11, 0.15)',
          color: isEdu ? '#34d399' : '#f5a623',
          border: `1px solid ${isEdu ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
        }}
      >
        {isEdu ? (
          <>
            <GraduationCap className="w-4 h-4" />
            <span>Educational</span>
            {educationalTier === 'premium' && <Crown className="w-3 h-3 ml-1" />}
          </>
        ) : (
          <>
            <Briefcase className="w-4 h-4" />
            <span>Professional</span>
          </>
        )}
      </button>

      {/* Mode Selection Modal */}
      <AnimatePresence>
        {showDetails && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40"
              onClick={() => setShowDetails(false)}
            />

            {/* Modal */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -10 }}
              className="absolute right-0 top-full mt-2 w-96 z-50 rounded-2xl overflow-hidden shadow-2xl"
              style={{
                background: 'var(--tb-bg-surface)',
                border: '1px solid var(--tb-border)',
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--tb-border)]">
                <span className="text-sm font-semibold" style={{ color: 'var(--tb-text-primary)' }}>
                  Choose Your Mode
                </span>
                <button
                  onClick={() => setShowDetails(false)}
                  className="p-1 rounded-lg hover:bg-white/5 transition-colors"
                >
                  <X className="w-4 h-4" style={{ color: 'var(--tb-text-muted)' }} />
                </button>
              </div>

              {/* Educational Mode */}
              <div className="p-4">
                <button
                  onClick={() => {
                    setMode('educational');
                    setShowDetails(false);
                  }}
                  className={`w-full text-left p-4 rounded-xl transition-all duration-200 ${
                    isEdu
                      ? 'ring-2 ring-emerald-500/50 bg-emerald-500/10'
                      : 'hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="p-2 rounded-lg"
                      style={{ background: 'rgba(16, 185, 129, 0.2)' }}
                    >
                      <GraduationCap className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[var(--tb-text-primary)]">
                          Educational Mode
                        </span>
                        <span
                          className="text-xs px-2 py-0.5 rounded-full"
                          style={{
                            background: 'rgba(16, 185, 129, 0.2)',
                            color: '#34d399',
                          }}
                        >
                          Free
                        </span>
                      </div>
                      <p className="text-xs mt-1" style={{ color: 'var(--tb-text-secondary)' }}>
                        Perfect for learning thermodynamics with guided tutorials,
                        hints, and progress tracking.
                      </p>

                      {/* Tier Selection — only visible in educational mode */}
                      {isEdu && (
                        <div className="flex gap-2 mt-3">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEducationalTier('free');
                            }}
                            className={`flex-1 text-xs py-1.5 px-2 rounded-lg transition-colors ${
                              educationalTier === 'free'
                                ? 'bg-emerald-500/30 text-emerald-300'
                                : 'bg-white/5 text-[var(--tb-text-muted)] hover:bg-white/10'
                            }`}
                          >
                            Free Tier
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEducationalTier('premium');
                            }}
                            className={`flex-1 text-xs py-1.5 px-2 rounded-lg transition-colors flex items-center justify-center gap-1 ${
                              educationalTier === 'premium'
                                ? 'bg-amber-500/30 text-amber-300'
                                : 'bg-white/5 text-[var(--tb-text-muted)] hover:bg-white/10'
                            }`}
                          >
                            <Crown className="w-3 h-3" />
                            Premium
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </button>

                {/* Professional Mode */}
                <button
                  onClick={() => {
                    setMode('professional');
                    setShowDetails(false);
                  }}
                  className={`w-full text-left p-4 rounded-xl mt-3 transition-all duration-200 ${
                    !isEdu
                      ? 'ring-2 ring-amber-500/50 bg-amber-500/10'
                      : 'hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="p-2 rounded-lg"
                      style={{ background: 'rgba(245, 158, 11, 0.2)' }}
                    >
                      <Briefcase className="w-5 h-5 text-amber-400" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[var(--tb-text-primary)]">
                          Professional Mode
                        </span>
                        <span
                          className="text-xs px-2 py-0.5 rounded-full"
                          style={{
                            background: 'rgba(245, 158, 11, 0.2)',
                            color: '#f5a623',
                          }}
                        >
                          Full Access
                        </span>
                      </div>
                      <p className="text-xs mt-1" style={{ color: 'var(--tb-text-secondary)' }}>
                        For engineers and researchers. Full solver suite,
                        TBS scripting, parametric studies, and export options.
                      </p>
                    </div>
                  </div>
                </button>
              </div>

              {/* Footer */}
              <div
                className="px-4 py-3 text-xs border-t"
                style={{
                  background: 'var(--tb-bg-elevated)',
                  borderColor: 'var(--tb-border)',
                  color: 'var(--tb-text-muted)',
                }}
              >
                You can switch modes anytime. Your work is preserved.
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// Mode indicator badge for headers
export function ModeBadge() {
  const mode           = useModeStore(s => s.mode);
  const educationalTier= useModeStore(s => s.educationalTier);
  const isEdu          = mode === 'educational';

  if (isEdu) {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
        style={{
          background: educationalTier === 'premium'
            ? 'rgba(245, 158, 11, 0.15)'
            : 'rgba(16, 185, 129, 0.15)',
          color: educationalTier === 'premium' ? '#f5a623' : '#34d399',
        }}
      >
        <GraduationCap className="w-3 h-3" />
        {educationalTier === 'premium' ? 'Edu Premium' : 'Educational'}
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
      style={{
        background: 'rgba(245, 158, 11, 0.15)',
        color: '#f5a623',
      }}
    >
      <Briefcase className="w-3 h-3" />
      Professional
    </span>
  );
}
