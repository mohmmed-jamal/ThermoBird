/**
 * Energy & Efficiency Tab
 * Shows thermal efficiency, Carnot limit, and exergy efficiency over time
 */

import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, Legend, ReferenceLine
} from 'recharts';
import { useSimulationStore } from '../../../store/simulationStore';

export function EnergyEfficiencyTab() {
  const { result, config } = useSimulationStore();
  
  const data = useMemo(() => {
    if (!result) return [];
    
    if (config.mode === 'transient' && result.time_points) {
      return result.time_points.map(tp => ({
        time: tp.t,
        eta_thermal: (tp.eta_thermal * 100),
        eta_carnot: (tp.eta_carnot * 100),
        epsilon: (tp.epsilon_exergy * 100)
      }));
    }
    
    // Steady state - single point
    return [{
      time: 0,
      eta_thermal: ((result as any).eta_thermal * 100) || 0,
      eta_carnot: ((result as any).eta_carnot * 100) || 0,
      epsilon: 0
    }];
  }, [result, config.mode]);
  
  const isTransient = config.mode === 'transient';
  
  return (
    <div className="space-y-6">
      {/* Efficiency Chart */}
      <div 
        className="rounded-xl p-4"
        style={{ 
          background: 'var(--tb-bg-elevated)',
          border: '1px solid var(--tb-border-soft)'
        }}
      >
        <h3 
          className="text-sm font-semibold mb-4"
          style={{ color: 'var(--tb-text-primary)' }}
        >
          Efficiency Evolution
        </h3>
        
        <div style={{ height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid 
                strokeDasharray="3 3" 
                stroke="var(--tb-border-soft)"
              />
              <XAxis 
                dataKey="time"
                stroke="var(--tb-text-muted)"
                fontSize={11}
                label={{ 
                  value: 'Time (s)', 
                  position: 'insideBottom', 
                  offset: -5,
                  fill: 'var(--tb-text-muted)'
                }}
              />
              <YAxis 
                stroke="var(--tb-text-muted)"
                fontSize={11}
                label={{ 
                  value: 'Efficiency (%)', 
                  angle: -90, 
                  position: 'insideLeft',
                  fill: 'var(--tb-text-muted)'
                }}
                domain={[0, 80]}
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--tb-bg-surface)',
                  border: '1px solid var(--tb-border)',
                  borderRadius: '8px',
                  color: 'var(--tb-text-primary)'
                }}
                formatter={(value: number) => [`${value.toFixed(1)}%`, '']}
              />
              <Legend />
              
              <Line
                type="monotone"
                dataKey="eta_thermal"
                name="η_thermal (%)"
                stroke="#0ea5e9"
                strokeWidth={2}
                dot={false}
                isAnimationActive={isTransient}
              />
              <Line
                type="monotone"
                dataKey="eta_carnot"
                name="η_Carnot (%)"
                stroke="#818cf8"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
                isAnimationActive={isTransient}
              />
              <Line
                type="monotone"
                dataKey="epsilon"
                name="ε_exergy (%)"
                stroke="#34d399"
                strokeWidth={2}
                strokeDasharray="3 3"
                dot={false}
                isAnimationActive={isTransient}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      
      {/* Efficiency Metrics */}
      <div className="grid grid-cols-3 gap-4">
        <MetricCard
          label="Thermal Efficiency"
          value={data[data.length - 1]?.eta_thermal || 0}
          unit="%"
          color="#0ea5e9"
          description="Net work output / Heat input"
        />
        <MetricCard
          label="Carnot Efficiency"
          value={data[data.length - 1]?.eta_carnot || 0}
          unit="%"
          color="#818cf8"
          description="1 - T_cold / T_hot"
        />
        <MetricCard
          label="Exergy Efficiency"
          value={data[data.length - 1]?.epsilon || 0}
          unit="%"
          color="#34d399"
          description="Exergy output / Exergy input"
        />
      </div>
    </div>
  );
}

interface MetricCardProps {
  label: string;
  value: number;
  unit: string;
  color: string;
  description: string;
}

function MetricCard({ label, value, unit, color, description }: MetricCardProps) {
  return (
    <div 
      className="rounded-xl p-4"
      style={{ 
        background: 'var(--tb-bg-elevated)',
        border: '1px solid var(--tb-border-soft)'
      }}
    >
      <span 
        className="text-xs font-medium block mb-1"
        style={{ color: 'var(--tb-text-muted)' }}
      >
        {label}
      </span>
      <span 
        className="text-2xl font-bold"
        style={{ color, fontFamily: 'Outfit, sans-serif' }}
      >
        {value.toFixed(1)} {unit}
      </span>
      <p 
        className="text-xs mt-2"
        style={{ color: 'var(--tb-text-muted)' }}
      >
        {description}
      </p>
    </div>
  );
}
