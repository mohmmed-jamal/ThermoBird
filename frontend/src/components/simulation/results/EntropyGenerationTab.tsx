/**
 * Entropy Generation Tab
 * Shows entropy generation by component over time
 */

import { useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { useSimulationStore } from '../../../store/simulationStore';

export function EntropyGenerationTab() {
  const { result, config } = useSimulationStore();
  
  const data = useMemo(() => {
    if (!result?.time_points) return [];
    
    return result.time_points.map(tp => {
      const row: any = { time: tp.t };
      
      // Extract entropy generation by component
      Object.entries(tp.entropy_generation || {}).forEach(([comp, s_gen]) => {
        row[comp] = s_gen / 1000; // Convert to kW/K
      });
      
      row.total = Object.values(tp.entropy_generation || {})
        .reduce((a, b) => a + b, 0) / 1000;
      
      return row;
    });
  }, [result]);
  
  const components = useMemo(() => {
    if (!data.length) return [];
    return Object.keys(data[0]).filter(k => k !== 'time' && k !== 'total');
  }, [data]);
  
  const colors = ['#f87171', '#fbbf24', '#34d399', '#60a5fa', '#a78bfa', '#f472b6'];
  
  return (
    <div className="space-y-6">
      {/* Entropy Generation Chart */}
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
          Entropy Generation by Component
        </h3>
        
        <div style={{ height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
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
                  value: 'Ṡ_gen (kW/K)', 
                  angle: -90, 
                  position: 'insideLeft',
                  fill: 'var(--tb-text-muted)'
                }}
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--tb-bg-surface)',
                  border: '1px solid var(--tb-border)',
                  borderRadius: '8px',
                  color: 'var(--tb-text-primary)'
                }}
                formatter={(value: number) => [`${value.toFixed(3)} kW/K`, '']}
              />
              <Legend />
              
              {components.map((comp, i) => (
                <Area
                  key={comp}
                  type="monotone"
                  dataKey={comp}
                  name={`Ṡ_${comp}`}
                  stackId="1"
                  stroke={colors[i % colors.length]}
                  fill={colors[i % colors.length]}
                  fillOpacity={0.6}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      
      {/* Total Entropy Generation */}
      <div className="grid grid-cols-2 gap-4">
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
            Total Entropy Generation
          </span>
          <span 
            className="text-2xl font-bold"
            style={{ color: '#f87171', fontFamily: 'Outfit, sans-serif' }}
          >
            {data[data.length - 1]?.total.toFixed(3) || 0}
            <span className="text-sm ml-1" style={{ color: 'var(--tb-text-muted)' }}>
              kW/K
            </span>
          </span>
          <p 
            className="text-xs mt-2"
            style={{ color: 'var(--tb-text-muted)' }}
          >
            Second law performance indicator
          </p>
        </div>
        
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
            Gouy-Stodola Loss
          </span>
          <span 
            className="text-2xl font-bold"
            style={{ color: '#fbbf24', fontFamily: 'Outfit, sans-serif' }}
          >
            {((data[data.length - 1]?.total || 0) * 298.15).toFixed(0)}
            <span className="text-sm ml-1" style={{ color: 'var(--tb-text-muted)' }}>
              kW
            </span>
          </span>
          <p 
            className="text-xs mt-2"
            style={{ color: 'var(--tb-text-muted)' }}
          >
            X_destroyed = T₀ × Ṡ_gen
          </p>
        </div>
      </div>
    </div>
  );
}
