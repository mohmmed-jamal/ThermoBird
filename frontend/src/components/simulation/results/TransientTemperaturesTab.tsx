/**
 * Transient Temperatures Tab
 * Shows temperature evolution of fluid and walls over time
 */

import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine
} from 'recharts';
import { useSimulationStore } from '../../../store/simulationStore';

export function TransientTemperaturesTab() {
  const { result, config } = useSimulationStore();
  
  const data = useMemo(() => {
    if (!result?.time_points) return [];
    
    return result.time_points.map(tp => {
      const row: any = { time: tp.t };
      
      // Extract temperatures from component states
      Object.entries(tp.component_states || {}).forEach(([compId, state]: [string, any]) => {
        if (state.T !== undefined) {
          row[`${compId}_T`] = state.T - 273.15;  // Convert to °C
        }
        if (state.T_wall !== undefined) {
          row[`${compId}_wall`] = state.T_wall - 273.15;
        }
      });
      
      return row;
    });
  }, [result]);
  
  // Get temperature series
  const tempSeries = useMemo(() => {
    if (!data.length) return [];
    return Object.keys(data[0]).filter(k => k !== 'time');
  }, [data]);
  
  const colors = ['#0ea5e9', '#f59e0b', '#34d399', '#f87171', '#a78bfa', '#22d3ee'];
  
  // Check if transient mode
  if (config.mode !== 'transient') {
    return (
      <div 
        className="rounded-xl p-8 text-center"
        style={{ 
          background: 'var(--tb-bg-elevated)',
          border: '1px solid var(--tb-border-soft)'
        }}
      >
        <p style={{ color: 'var(--tb-text-muted)' }}>
          Temperature evolution is only available in Transient mode.
        </p>
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      {/* Temperature Chart */}
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
          Temperature Evolution
        </h3>
        
        <div style={{ height: 350 }}>
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
                  value: 'Temperature (°C)', 
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
                formatter={(value: number) => [`${value.toFixed(1)} °C`, '']}
              />
              <Legend />
              
              {tempSeries.map((series, i) => (
                <Line
                  key={series}
                  type="monotone"
                  dataKey={series}
                  name={series.replace('_', ' ')}
                  stroke={colors[i % colors.length]}
                  strokeWidth={2}
                  dot={false}
                  strokeDasharray={series.includes('wall') ? '5 5' : undefined}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      
      {/* Temperature Metrics */}
      <div className="grid grid-cols-3 gap-4">
        {tempSeries.slice(0, 3).map((series, i) => {
          const finalTemp = data[data.length - 1]?.[series] || 0;
          const initialTemp = data[0]?.[series] || 0;
          const maxTemp = Math.max(...data.map(d => d[series] || 0));
          
          return (
            <div 
              key={series}
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
                {series.replace('_', ' ')}
              </span>
              <div className="flex items-baseline gap-2">
                <span 
                  className="text-xl font-bold"
                  style={{ color: colors[i % colors.length], fontFamily: 'Outfit, sans-serif' }}
                >
                  {finalTemp.toFixed(1)}
                </span>
                <span className="text-sm" style={{ color: 'var(--tb-text-muted)' }}>
                  °C
                </span>
              </div>
              <div className="mt-2 text-xs" style={{ color: 'var(--tb-text-muted)' }}>
                Max: {maxTemp.toFixed(1)}°C • ΔT: {(finalTemp - initialTemp).toFixed(1)}°C
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
