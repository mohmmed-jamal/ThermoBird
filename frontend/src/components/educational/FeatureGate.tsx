/**
 * ThermoBird — Feature Gate Component
 * 
 * Locks features based on mode and tier.
 * Shows upgrade prompt for locked features.
 */

import { motion } from 'framer-motion';
import { Lock, Crown, ArrowRight } from 'lucide-react';
import { useModeStore, useAccess } from '../../store/modeStore';
import type { FeatureAccess } from '../../store/modeStore';

interface FeatureGateProps {
  feature: keyof FeatureAccess;
  children: React.ReactNode;
  fallback?: 'lock' | 'hide' | 'blur';
}

export function FeatureGate({ feature, children, fallback = 'lock' }: FeatureGateProps) {
  const mode           = useModeStore(s => s.mode);
  const educationalTier= useModeStore(s => s.educationalTier);
  const canAccess      = useModeStore(s => s.canAccess);
  const isEducational  = mode === 'educational';
  const hasAccess = canAccess(feature);

  if (hasAccess) {
    return <>{children}</>;
  }

  if (fallback === 'hide') {
    return null;
  }

  if (fallback === 'blur') {
    return (
      <div className="relative">
        <div className="blur-sm pointer-events-none select-none">
          {children}
        </div>
        <UpgradeOverlay feature={feature} />
      </div>
    );
  }

  // Default: lock overlay
  return (
    <div className="relative">
      <div className="opacity-30 pointer-events-none select-none grayscale">
        {children}
      </div>
      <UpgradeOverlay feature={feature} />
    </div>
  );
}

function UpgradeOverlay({ feature }: { feature: keyof FeatureAccess }) {
  const mode2           = useModeStore(s => s.mode);
  const educationalTier2= useModeStore(s => s.educationalTier);
  const isEducational   = mode2 === 'educational';
  const educationalTier = educationalTier2;

  const getUpgradeMessage = () => {
    if (isEducational && educationalTier === 'free') {
      return {
        title: 'Premium Feature',
        description: 'Upgrade to Educational Premium to unlock this feature.',
        cta: 'Upgrade to Premium',
        icon: Crown,
        color: '#f5a623',
      };
    }

    return {
      title: 'Professional Feature',
      description: 'Switch to Professional mode for full access to all features.',
      cta: 'Go Professional',
      icon: Lock,
      color: 'var(--tb-accent)',
    };
  };

  const message = getUpgradeMessage();
  const Icon = message.icon;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="absolute inset-0 flex items-center justify-center"
    >
      <div
        className="rounded-xl p-6 text-center max-w-xs"
        style={{
          background: 'var(--tb-bg-surface)',
          border: '1px solid var(--tb-border)',
          boxShadow: 'var(--tb-panel-shadow)',
        }}
      >
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
          style={{ background: `${message.color}20` }}
        >
          <Icon className="w-6 h-6" style={{ color: message.color }} />
        </div>

        <h3
          className="font-semibold mb-1"
          style={{ color: 'var(--tb-text-primary)' }}
        >
          {message.title}
        </h3>

        <p
          className="text-sm mb-4"
          style={{ color: 'var(--tb-text-secondary)' }}
        >
          {message.description}
        </p>

        <button
          className="flex items-center justify-center gap-2 w-full py-2 px-4 rounded-lg text-sm font-medium transition-all duration-200"
          style={{
            background: message.color,
            color: '#fff',
          }}
        >
          {message.cta}
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
  );
}

// Badge for indicating limited features
export function LimitBadge({ 
  current, 
  max, 
  label 
}: { 
  current: number; 
  max: number; 
  label: string;
}) {
  const isAtLimit = current >= max;

  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
      style={{
        background: isAtLimit 
          ? 'rgba(251,113,133,0.15)' 
          : 'var(--tb-bg-elevated)',
        color: isAtLimit ? 'var(--tb-rose)' : 'var(--tb-text-muted)',
        border: `1px solid ${isAtLimit ? 'var(--tb-rose)' : 'var(--tb-border)'}`,
      }}
    >
      {isAtLimit && <Lock className="w-3 h-3" />}
      {current} / {max === Infinity ? '∞' : max} {label}
    </span>
  );
}

// Component count limiter
export function ComponentLimiter({ 
  currentCount, 
  onAdd 
}: { 
  currentCount: number;
  onAdd: () => void;
}) {
  const access = useAccess();
  const maxComponents = access.maxComponents;
  const canAdd = currentCount < maxComponents;

  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--tb-bg-elevated)]">
      <div>
        <span className="text-sm font-medium" style={{ color: 'var(--tb-text-primary)' }}>
          Components
        </span>
        <LimitBadge 
          current={currentCount} 
          max={maxComponents} 
          label="used" 
        />
      </div>

      <button
        onClick={onAdd}
        disabled={!canAdd}
        className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          background: canAdd ? 'var(--tb-accent)' : 'var(--tb-bg-surface)',
          color: '#fff',
        }}
      >
        + Add Component
      </button>
    </div>
  );
}
