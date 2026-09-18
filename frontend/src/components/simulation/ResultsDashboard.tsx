/**
 * Rich Results Dashboard with multiple visualization tabs
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Zap, Thermometer, BarChart3, Activity,
  Download, FileText, Table2, TrendingUp
} from 'lucide-react';
import { useSimulationStore } from '../../store/simulationStore';
import { EnergyEfficiencyTab } from './results/EnergyEfficiencyTab';
import { EntropyGenerationTab } from './results/EntropyGenerationTab';
import { ExergyDestructionTab } from './results/ExergyDestructionTab';
import { TransientTemperaturesTab } from './results/TransientTemperaturesTab';
import { StatePointsTab } from './results/StatePointsTab';

interface TabDef {
  id: string;
  label: string;
  icon: React.ReactNode;
  component: React.FC;
  disabled?: boolean;
}

const TABS: TabDef[] = [
  {
    id: 'energy',
    label: 'Energy & Efficiency',
    icon: <Zap className="w-4 h-4" />,
    component: EnergyEfficiencyTab
  },
  {
    id: 'entropy',
    label: 'Entropy Generation',
    icon: <Activity className="w-4 h-4" />,
    component: EntropyGenerationTab
  },
  {
    id: 'exergy',
    label: 'Exergy Destruction',
    icon: <BarChart3 className="w-4 h-4" />,
    component: ExergyDestructionTab
  },
  {
    id: 'temperatures',
    label: 'Transient Temperatures',
    icon: <Thermometer className="w-4 h-4" />,
    component: TransientTemperaturesTab
  },
  {
    id: 'states',
    label: 'State Points',
    icon: <Table2 className="w-4 h-4" />,
    component: StatePointsTab
  }
];

export function ResultsDashboard() {
  const { result, activeResultTab, setActiveResultTab, config } = useSimulationStore();
  
  if (!result) return null;
  
  const isTransient = config.mode === 'transient';
  
  return (
    <div 
      className="rounded-2xl overflow-hidden"
      style={{ 
        border: '1px solid var(--tb-border)',
        background: 'var(--tb-bg-surface)'
      }}
    >
      {/* Header with KPI Cards */}
      <div className="p-6" style={{ borderBottom: '1px solid var(--tb-border)' }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 
              className="text-lg font-bold"
              style={{ color: 'var(--tb-text-primary)', fontFamily: 'Outfit, sans-serif' }}
            >
              Simulation Results
            </h2>
            <p className="text-sm" style={{ color: 'var(--tb-text-muted)' }}>
              {result.cycle_type} cycle • {config.fluid} • 
              {isTransient ? `Transient (${config.t_end}s)` : 'Steady State'}
            </p>
          </div>
          
          <div className="flex items-center gap-2">
            <ExportButton format="csv" />
            <ExportButton format="pdf" />
          </div>
        </div>
        
        {/* KPI Grid */}
        <KPIGrid result={result} isTransient={isTransient} />
      </div>
      
      {/* Tab Bar */}
      <div 
        className="flex items-center px-4 gap-1"
        style={{ 
          borderBottom: '1px solid var(--tb-border)',
          background: 'var(--tb-bg-elevated)'
        }}
      >
        {TABS.map((tab) => {
          const isActive = activeResultTab === tab.id;
          const isDisabled = tab.disabled || 
            (tab.id === 'temperatures' && !isTransient);
          
          return (
            <button
              key={tab.id}
              onClick={() => !isDisabled && setActiveResultTab(tab.id)}
              disabled={isDisabled}
              className="relative flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors"
              style={{
                color: isActive ? 'var(--tb-accent)' : 
                       isDisabled ? 'var(--tb-text-muted)' : 
                       'var(--tb-text-secondary)',
                opacity: isDisabled ? 0.4 : 1,
                cursor: isDisabled ? 'not-allowed' : 'pointer'
              }}
            >
              {tab.icon}
              {tab.label}
              
              {isActive && (
                <motion.div
                  layoutId="results-tab-indicator"
                  className="absolute bottom-0 left-0 right-0 h-0.5"
                  style={{ background: 'var(--tb-accent)' }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
            </button>
          );
        })}
      </div>
      
      {/* Tab Content */}
      <div className="p-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeResultTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {(() => {
              const TabComponent = TABS.find(t => t.id === activeResultTab)?.component;
              return TabComponent ? <TabComponent /> : null;
            })()}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

interface KPIGridProps {
  result: any;
  isTransient: boolean;
}

function KPIGrid({ result, isTransient }: KPIGridProps) {
  // Get final values (for transient) or steady values
  const finalMetrics = isTransient && result.time_points?.length > 0
    ? result.time_points[result.time_points.length - 1]
    : result;
  
  const kpis = [
    {
      label: 'Thermal Efficiency',
      value: finalMetrics?.eta_thermal || result.eta_thermal || 0,
      unit: '%',
      format: (v: number) => (v * 100).toFixed(1),
      color: '#34d399',
      icon: <Zap className="w-5 h-5" />,
      description: 'First-law cycle efficiency'
    },
    {
      label: 'Carnot Limit',
      value: finalMetrics?.eta_carnot || result.eta_carnot || 0,
      unit: '%',
      format: (v: number) => (v * 100).toFixed(1),
      color: '#818cf8',
      icon: <TrendingUp className="w-5 h-5" />,
      description: 'Theoretical maximum'
    },
    {
      label: 'Net Power Output',
      value: finalMetrics?.W_net || result.W_net || 0,
      unit: 'kW',
      format: (v: number) => (v / 1000).toFixed(2),
      color: '#f59e0b',
      icon: <Activity className="w-5 h-5" />,
      description: 'Turbine - Pump work'
    },
    {
      label: 'Heat Input',
      value: finalMetrics?.Q_in || result.Q_in || 0,
      unit: 'kW',
      format: (v: number) => (v / 1000).toFixed(2),
      color: '#f87171',
      icon: <Thermometer className="w-5 h-5" />,
      description: 'Total heat addition'
    }
  ];
  
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {kpis.map((kpi) => (
        <motion.div
          key={kpi.label}
          className="rounded-xl p-4"
          style={{ 
            background: 'var(--tb-bg-elevated)',
            border: '1px solid var(--tb-border-soft)'
          }}
          whileHover={{ scale: 1.02 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        >
          <div className="flex items-start justify-between mb-2">
            <span 
              className="text-xs font-medium"
              style={{ color: 'var(--tb-text-muted)' }}
            >
              {kpi.label}
            </span>
            <span style={{ color: kpi.color }}>
              {kpi.icon}
            </span>
          </div>
          
          <div className="flex items-baseline gap-1">
            <span 
              className="text-2xl font-bold"
              style={{ color: kpi.color, fontFamily: 'Outfit, sans-serif' }}
            >
              {kpi.format(kpi.value)}
            </span>
            <span 
              className="text-sm"
              style={{ color: 'var(--tb-text-muted)' }}
            >
              {kpi.unit}
            </span>
          </div>
          
          <p 
            className="text-xs mt-1"
            style={{ color: 'var(--tb-text-muted)' }}
          >
            {kpi.description}
          </p>
        </motion.div>
      ))}
    </div>
  );
}

function ExportButton({ format }: { format: 'csv' | 'pdf' }) {
  const Icon = format === 'csv' ? Table2 : FileText;
  
  return (
    <button
      className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
      style={{ 
        background: format === 'pdf' ? 'var(--tb-accent)' : 'var(--tb-bg-elevated)',
        color: format === 'pdf' ? '#fff' : 'var(--tb-text-secondary)',
        border: '1px solid var(--tb-border)'
      }}
    >
      <Icon className="w-3.5 h-3.5" />
      Export {format.toUpperCase()}
    </button>
  );
}
