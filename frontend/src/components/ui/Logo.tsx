/**
 * ThermoBird brand mark.
 *
 * Upswept wings with a short beak — a bird mid-flight. Rendered as flat,
 * folded-paper facets in two colors only (no gradient blending): a deep
 * burgundy red and a rich navy blue.
 */
const RED = '#7A2333';
const BLUE = '#274873';

export function LogoMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 90"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <g transform="translate(40,46)">
        <polygon points="0,-4 -28,-32 -14,6 0,12" fill={BLUE} />
        <polygon points="0,-4 28,-32 14,6 0,12" fill={RED} />
        <polygon points="-4,10 0,26 4,10" fill={RED} />
        <polygon points="0,10 4,26 0,12" fill={BLUE} />
        <polygon points="0,-4 -5,-14 0,-14" fill={BLUE} />
        <polygon points="0,-4 5,-14 0,-14" fill={RED} />
        <polygon points="0,-14 10,-19 3,-11" fill={BLUE} />
      </g>
    </svg>
  );
}

export default function Logo({
  size = 22,
  showWordmark = true,
  wordmarkClassName,
  className,
}: {
  size?: number;
  showWordmark?: boolean;
  wordmarkClassName?: string;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ''}`}>
      <LogoMark size={size} />
      {showWordmark && (
        <span
          className={wordmarkClassName}
          style={{ fontFamily: 'Outfit, Inter, sans-serif', fontWeight: 700, letterSpacing: '-0.02em' }}
        >
          ThermoBird
        </span>
      )}
    </span>
  );
}
