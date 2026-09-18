/**
 * Exergy Destruction Tab
 * Shows exergy destruction breakdown and Sankey-style visualization
 */

import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell
} from 'recharts';
import { useSimulationStore } from '../../../store/simulationStore';

export function ExergyDestructionTab() {
  const { result, config } = useSimulationStore();
  
  // Get final exergy destruction values
  const exergyData = useMemo(() => {
    if (!result?.time_points?.length) {
      // Steady state
      return Object.entries(result?.component_results || {})
        .filter(([_, r]: [string, any]) => r.X_dest !== undefined)
        .map(([comp, r]: [string, any]) => ({
          component: comp,
          X_dest: (r.X_dest || 0) / 1000,  // kW
          X_dest_pct: 0
        }));
    }
    
    // Transient - use final values
    const final = result.time_points[result.time_points.length - 1];
    const total = Object.values(final.exergy_destruction || {})
      .reduce((a, b) => a + b, 0);
    
    return Object.entries(final.exergy_destruction || {})
      .map(([comp, x_dest]) => ({
        component: comp,
        X_dest: (x_dest as number) / 1000,  // kW
        X_dest_pct: total > 0 ? ((x_dest as number) / total) * 100 : 0
      }))
      .sort((a, b) => b.X_dest - a.X_dest);
  }, [result]);
  
  const colors = ['#f87171', '#fb923c', '#fbbf24', '#a3e635', '#34d399', '#22d3ee'];
  
  return (
    <div className="space-y-6">
      {/* Exergy Destruction Bar Chart */}
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
          Exergy Destruction by Component
        </h3>
        
        <div style={{ height: 250 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={exergyData} layout="vertical">
              <CartesianGrid 
                strokeDasharray="3 3" 
                stroke="var(--tb-border-soft)"
                horizontal={false}
              />
              <XAxis 
                type="number"
                stroke="var(--tb-text-muted)"
                fontSize={11}
                label={{ 
                  value: 'X_dest (kW)', 
                  position: 'insideBottom', 
                  offset: -5,
                  fill: 'var(--tb-text-muted)'
                }}
              />
              <YAxis 
                type="category"
                dataKey="component"
                stroke="var(--tb-text-muted)"
                fontSize={11}
                width={100}
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--tb-bg-surface)',
                  border: '1px solid var(--tb-border)',
                  borderRadius: '8px',
                  color: 'var(--tb-text-primary)'
                }}
                formatter={(value: number, name: string, props: any) => [
                  `${value.toFixed(2)} kW (${props.payload.X_dest_pct.toFixed(1)}%)`,
                  'Exergy Destruction'
                ]}
              />
              <Bar dataKey="X_dest" radius={[0, 4, 4, 0]}>
                {exergyData.map((_, i) => (
                  <Cell key={`cell-${i}`} fill={colors[i % colors.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      
      {/* Exergy Destruction Breakdown - Visual Bar */}
      <div 
        className="rounded-xl p-4"
        style={{ 
          background: 'var(--tb-bg-elevated)',
          border: '1px solid var(--tb-border-soft)'
        }}
      >
        <h3 
          className="text-sm font-semibold mb-3"
          style={{ color: 'var(--tb-text-primary)' }}
        >
          Exergy Destruction Breakdown
        </h3>
        
        {/* Stacked bar visualization */}
        <div className="h-8 rounded-full overflow-hidden flex mb-3">
          {exergyData.map((item, i) => (
            <div
              key={item.component}
              style={{
                width: `${item.X_dest_pct}%`,
                background: colors[i % colors.length]
              }}
              className="h-full"
              title={`${item.component}: ${item.X_dest.toFixed(2)} kW (${item.X_dest_pct.toFixed(1)}%)`}
            />
          ))}
        </div>
        
        {/* Legend */}
        <div className="flex flex-wrap gap-3">
          {exergyData.map((item, i) => (
            <div key={item.component} className="flex items-center gap-1.5">
              <div 
                className="w-3 h-3 rounded"
                style={{ background: colors[i % colors.length] }}
              />
              <span className="text-xs" style={{ color: 'var(--tb-text-secondary)' }}>
                {item.component}: {item.X_dest.toFixed(1)} kW
              </span>
            </div>
          ))}
        </div>
      </div>
      
      {/* Exergy Analysis Note */}
      <div 
        className="rounded-xl p-4 text-sm"
        style={{ 
          background: 'rgba(14, 165, 233, 0.1)',
          border: '1px solid rgba(14, 165, 233, 0.3)'
        }}
      >
        <p style={{ color: 'var(--tb-text-secondary)' }}>
          <strong style={{ color: '#0ea5e9' }}>Gouy-Stodola Theorem:</strong>{' '}
          Exergy destruction is calculated as Ẋ_dest = T₀ × Ṡ_gen, where T₀ is the dead-state temperature ({config.T0} K) and Ṡ_gen is the entropy generation rate.
        </p>
      </div>
    </div>
  );
}
