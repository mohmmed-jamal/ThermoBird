/**
 * ConnectionLine — bezier curve between two component ports.
 *
 * Now supports:
 *   - isSelected / onSelect  → click to select, highlighted in accent colour
 *   - Delete key in SimulationCanvas removes the selected line
 */
interface Props {
  from:          { x: number; y: number };
  to:            { x: number; y: number };
  fromPort:      string;
  toPort:        string;
  fluid:         string;
  stateNum?:     number;
  isSelected?:   boolean;
  onSelect?:     () => void;
}

export default function ConnectionLine({ from, to, fluid, stateNum, isSelected, onSelect }: Props) {
  const dx   = to.x - from.x;
  const dy   = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const tension = Math.max(60, Math.min(dist * 0.45, 220));

  const cp1x = from.x + tension;
  const cp1y = from.y;
  const cp2x = to.x   - tension;
  const cp2y = to.y;

  const d = `M ${from.x} ${from.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${to.x} ${to.y}`;

  const bezier = (t: number) => {
    const mt = 1 - t;
    return {
      x: mt*mt*mt*from.x + 3*mt*mt*t*cp1x + 3*mt*t*t*cp2x + t*t*t*to.x,
      y: mt*mt*mt*from.y + 3*mt*mt*t*cp1y + 3*mt*t*t*cp2y + t*t*t*to.y,
    };
  };

  const mid   = bezier(0.5);
  const badge = bezier(0.22);
  const R     = 9;

  const lineColor = isSelected ? '#f97316' : 'var(--tb-accent)';

  return (
    <g style={{ cursor: 'pointer' }} onClick={onSelect}>
      {/* Wide invisible hit area so the line is easy to click */}
      <path d={d} stroke="transparent" strokeWidth="14" fill="none" />

      {/* Soft glow */}
      <path d={d} stroke={lineColor} strokeWidth={isSelected ? 9 : 6}
            fill="none" opacity={isSelected ? 0.22 : 0.10} strokeLinecap="round" />

      {/* Main line */}
      <path d={d} stroke={lineColor} strokeWidth={isSelected ? 2.8 : 2}
            fill="none" strokeLinecap="round"
            markerEnd="url(#tb-arrow)"
            strokeDasharray={isSelected ? '6 3' : undefined} />

      {/* Fluid label at midpoint */}
      <text x={mid.x} y={mid.y - 8} textAnchor="middle" fontSize="9"
            fill={lineColor} opacity="0.85"
            style={{ pointerEvents: 'none', userSelect: 'none' }}>
        {fluid}
      </text>

      {/* State-point number badge */}
      {stateNum != null && (
        <g style={{ pointerEvents: 'none' }}>
          <circle cx={badge.x} cy={badge.y} r={R}
                  fill="var(--tb-bg-surface)" stroke={lineColor} strokeWidth="1.5" />
          <text x={badge.x} y={badge.y + 3.5} textAnchor="middle" fontSize="8.5"
                fontWeight="700" fill={lineColor}
                style={{ userSelect: 'none' }}>
            {stateNum}
          </text>
        </g>
      )}

      {/* Delete hint shown when selected */}
      {isSelected && (
        <g style={{ pointerEvents: 'none' }}>
          <rect x={mid.x - 28} y={mid.y + 10} width={56} height={16} rx={4}
                fill="rgba(249,115,22,0.15)" stroke="rgba(249,115,22,0.5)" strokeWidth="0.8" />
          <text x={mid.x} y={mid.y + 21} textAnchor="middle" fontSize="8"
                fill="#fb923c" style={{ userSelect: 'none' }}>
            Del to remove
          </text>
        </g>
      )}
    </g>
  );
}
