/**
 * State Points Tab
 * Shows thermodynamic state table for all cycle points
 */

import { useSimulationStore } from '../../../store/simulationStore';

export function StatePointsTab() {
  const { result } = useSimulationStore();
  
  const statePoints = result?.state_points || [];
  
  // Helper to format values
  const fmt = (v: number | null | undefined, decimals = 1) => {
    if (v === null || v === undefined) return '—';
    if (Math.abs(v) > 10000) return v.toExponential(2);
    return v.toFixed(decimals);
  };
  
  return (
    <div className="space-y-4">
      <div 
        className="rounded-xl overflow-hidden"
        style={{ 
          border: '1px solid var(--tb-border)',
          background: 'var(--tb-bg-elevated)'
        }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'var(--tb-bg-surface)' }}>
              <th 
                className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider"
                style={{ color: 'var(--tb-text-muted)' }}
              >
                State
              </th>
              <th 
                className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider"
                style={{ color: 'var(--tb-text-muted)' }}
              >
                Description
              </th>
              <th 
                className="px-4 py-3 text-right font-semibold text-xs uppercase tracking-wider"
                style={{ color: 'var(--tb-text-muted)' }}
              >
                T (°C)
              </th>
              <th 
                className="px-4 py-3 text-right font-semibold text-xs uppercase tracking-wider"
                style={{ color: 'var(--tb-text-muted)' }}
              >
                P (kPa)
              </th>
              <th 
                className="px-4 py-3 text-right font-semibold text-xs uppercase tracking-wider"
                style={{ color: 'var(--tb-text-muted)' }}
              >
                h (kJ/kg)
              </th>
              <th 
                className="px-4 py-3 text-right font-semibold text-xs uppercase tracking-wider"
                style={{ color: 'var(--tb-text-muted)' }}
              >
                s (kJ/kg·K)
              </th>
              <th 
                className="px-4 py-3 text-right font-semibold text-xs uppercase tracking-wider"
                style={{ color: 'var(--tb-text-muted)' }}
              >
                x
              </th>
              <th 
                className="px-4 py-3 text-right font-semibold text-xs uppercase tracking-wider"
                style={{ color: 'var(--tb-text-muted)' }}
              >
                ψ (kJ/kg)
              </th>
            </tr>
          </thead>
          <tbody>
            {statePoints.length === 0 ? (
              <tr>
                <td 
                  colSpan={8} 
                  className="px-4 py-8 text-center"
                  style={{ color: 'var(--tb-text-muted)' }}
                >
                  No state points available. Run a simulation to see results.
                </td>
              </tr>
            ) : (
              statePoints.map((state, i) => (
                <tr 
                  key={state.state}
                  style={{ 
                    borderTop: '1px solid var(--tb-border-soft)',
                    background: i % 2 === 0 ? 'var(--tb-bg-elevated)' : 'var(--tb-bg-surface)'
                  }}
                >
                  <td 
                    className="px-4 py-3 font-mono font-medium"
                    style={{ color: 'var(--tb-accent)' }}
                  >
                    {state.state}
                  </td>
                  <td 
                    className="px-4 py-3"
                    style={{ color: 'var(--tb-text-secondary)' }}
                  >
                    {state.description}
                  </td>
                  <td 
                    className="px-4 py-3 text-right font-mono"
                    style={{ color: 'var(--tb-text-primary)' }}
                  >
                    {fmt(state.T - 273.15)}
                  </td>
                  <td 
                    className="px-4 py-3 text-right font-mono"
                    style={{ color: 'var(--tb-text-primary)' }}
                  >
                    {fmt(state.P / 1000)}
                  </td>
                  <td 
                    className="px-4 py-3 text-right font-mono"
                    style={{ color: 'var(--tb-text-primary)' }}
                  >
                    {fmt(state.h / 1000)}
                  </td>
                  <td 
                    className="px-4 py-3 text-right font-mono"
                    style={{ color: 'var(--tb-text-primary)' }}
                  >
                    {fmt(state.s / 1000, 4)}
                  </td>
                  <td 
                    className="px-4 py-3 text-right font-mono"
                    style={{ color: 'var(--tb-text-primary)' }}
                  >
                    {state.x !== null ? fmt(state.x, 3) : '—'}
                  </td>
                  <td 
                    className="px-4 py-3 text-right font-mono"
                    style={{ color: 'var(--tb-text-primary)' }}
                  >
                    {fmt(state.psi / 1000)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      
      {/* Legend */}
      <div 
        className="text-xs p-4 rounded-xl"
        style={{ 
          background: 'var(--tb-bg-elevated)',
          border: '1px solid var(--tb-border-soft)',
          color: 'var(--tb-text-muted)'
        }}
      >
        <p className="mb-2"><strong>Property Definitions:</strong></p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <span><strong>T</strong> - Temperature</span>
          <span><strong>P</strong> - Pressure</span>
          <span><strong>h</strong> - Specific enthalpy</span>
          <span><strong>s</strong> - Specific entropy</span>
          <span><strong>x</strong> - Quality (vapor fraction)</span>
          <span><strong>ψ</strong> - Specific flow exergy</span>
        </div>
      </div>
    </div>
  );
}
