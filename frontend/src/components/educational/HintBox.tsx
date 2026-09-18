/**
 * ThermoBird — Educational Hint System
 * 
 * Provides contextual hints, explanations, and guidance for learners.
 * Only visible in Educational mode.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { Lightbulb, X, ChevronRight, BookOpen } from 'lucide-react';
import { useState } from 'react';
import { useModeStore } from '../../store/modeStore';

export type HintType = 'nudge' | 'explanation' | 'misconception' | 'suggestion';

interface Hint {
  id: string;
  type: HintType;
  title: string;
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  learnMoreLink?: string;
}

interface HintBoxProps {
  hint: Hint;
  onDismiss: () => void;
}

export function HintBox({ hint, onDismiss }: HintBoxProps) {
  const [expanded, setExpanded] = useState(true);
  const isEducational = useModeStore(s => s.mode === 'educational');

  if (!isEducational) return null;

  const colors = {
    nudge: {
      border: 'var(--tb-border-accent)',
      bg: 'var(--tb-accent-subtle)',
      icon: 'var(--tb-accent)',
    },
    explanation: {
      border: 'var(--tb-edu-primary)',
      bg: 'var(--tb-edu-subtle)',
      icon: 'var(--tb-edu-primary)',
    },
    misconception: {
      border: 'var(--tb-rose)',
      bg: 'var(--tb-rose-subtle)',
      icon: 'var(--tb-rose)',
    },
    suggestion: {
      border: 'var(--tb-gold)',
      bg: 'var(--tb-gold-subtle)',
      icon: 'var(--tb-gold)',
    },
  }[hint.type];

  return (
    <motion.div
      initial={{ opacity: 0, y: -10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.95 }}
      className="rounded-xl overflow-hidden"
      style={{
        background: colors.bg,
        border: `1px solid ${colors.border}`,
      }}
    >
      <div className="flex items-start gap-3 p-4">
        <div
          className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: `${colors.icon}20` }}
        >
          <Lightbulb className="w-4 h-4" style={{ color: colors.icon }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: colors.icon }}
            >
              {hint.type}
            </span>
            <button
              onClick={onDismiss}
              className="p-1 rounded hover:bg-black/5 transition-colors"
            >
              <X className="w-3.5 h-3.5" style={{ color: 'var(--tb-text-muted)' }} />
            </button>
          </div>

          <h4
            className="text-sm font-semibold mt-1"
            style={{ color: 'var(--tb-text-primary)' }}
          >
            {hint.title}
          </h4>

          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
              >
                <p
                  className="text-sm mt-2 leading-relaxed"
                  style={{ color: 'var(--tb-text-secondary)' }}
                >
                  {hint.message}
                </p>

                {hint.action && (
                  <button
                    onClick={hint.action.onClick}
                    className="flex items-center gap-1 mt-3 text-sm font-medium transition-colors hover:opacity-80"
                    style={{ color: colors.icon }}
                  >
                    {hint.action.label}
                    <ChevronRight className="w-4 h-4" />
                  </button>
                )}

                {hint.learnMoreLink && (
                  <a
                    href={hint.learnMoreLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 mt-3 text-xs transition-colors hover:opacity-80"
                    style={{ color: 'var(--tb-text-muted)' }}
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    Learn more
                  </a>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs mt-2 transition-colors hover:opacity-80"
            style={{ color: 'var(--tb-text-muted)' }}
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// Hook for managing hints
export function useHints() {
  const [hints, setHints] = useState<Hint[]>([]);
  const { canAccess } = useModeStore();

  const showHint = (hint: Omit<Hint, 'id'>) => {
    if (!canAccess('hints')) return;

    const newHint: Hint = {
      ...hint,
      id: Math.random().toString(36).substr(2, 9),
    };
    setHints((prev) => [...prev, newHint]);
  };

  const dismissHint = (id: string) => {
    setHints((prev) => prev.filter((h) => h.id !== id));
  };

  const clearHints = () => {
    setHints([]);
  };

  return { hints, showHint, dismissHint, clearHints };
}

// Predefined hints for common scenarios
export const COMMON_HINTS = {
  boilerPressureTooLow: (): Omit<Hint, 'id'> => ({
    type: 'misconception',
    title: 'Low Boiler Pressure',
    message: 'The boiler pressure is quite low. Remember that higher boiler pressures generally increase thermal efficiency by raising the average temperature of heat addition. However, stay below the critical pressure for your working fluid.',
    learnMoreLink: '/learn/rankine-efficiency',
  }),

  pumpWorkSign: (): Omit<Hint, 'id'> => ({
    type: 'misconception',
    title: 'Pump Work Sign Convention',
    message: 'Pump work is the work input required to pressurize the liquid. In thermodynamic calculations, work done ON the system is negative. Make sure you\'re accounting for this correctly in your energy balance.',
  }),

  tryParametric: (): Omit<Hint, 'id'> => ({
    type: 'suggestion',
    title: 'Explore Systematically',
    message: 'Try running a parametric study to see how changing the boiler pressure affects efficiency. This will help you understand the sensitivity of the cycle to this parameter.',
    action: {
      label: 'Open Parametric Analysis',
      onClick: () => {}, // Set by component
    },
  }),

  entropyNotConserved: (): Omit<Hint, 'id'> => ({
    type: 'explanation',
    title: 'Entropy Generation',
    message: 'Unlike energy, entropy is NOT conserved in real processes. Every irreversible process generates entropy. This is why we plot entropy generation rates in the results — it shows where the cycle is losing work potential.',
    learnMoreLink: '/learn/second-law',
  }),

  transientStartup: (): Omit<Hint, 'id'> => ({
    type: 'explanation',
    title: 'Startup Transient',
    message: 'You\'re watching a startup transient! The thermal mass of the boiler wall causes a delay between applying heat and reaching steady state. This is critical knowledge for power plant operators that steady-state analysis cannot provide.',
  }),

  exergyEfficiencyLower: (): Omit<Hint, 'id'> => ({
    type: 'explanation',
    title: 'Exergy vs Thermal Efficiency',
    message: 'Notice that exergy efficiency is always lower than thermal efficiency. This is because thermal efficiency compares work output to heat input, while exergy efficiency compares work output to the maximum possible work (exergy of heat input).',
    learnMoreLink: '/learn/exergy',
  }),
};
