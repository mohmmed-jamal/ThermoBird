import { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children:   ReactNode;
  /** Optional label shown in the fallback header, e.g. "Canvas" or "Results" */
  label?:     string;
  /** If true the fallback fills the full parent height */
  fullHeight?: boolean;
  /** Called when the user clicks "Try again" — defaults to reloading the page */
  onReset?:   () => void;
}

interface State { error: Error | null }

/**
 * Generic React error boundary.
 *
 * Catches any JS error thrown during render / lifecycle inside its subtree
 * and shows a friendly fallback instead of a white screen.
 *
 * Usage:
 *   <ErrorBoundary label="Canvas">
 *     <SimulationCanvas />
 *   </ErrorBoundary>
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Could send to a logging service here (Sentry etc.)
    console.error(`[ErrorBoundary${this.props.label ? ` / ${this.props.label}` : ''}]`, error, info);
  }

  reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (!this.state.error) return this.props.children;

    const { label = 'Component', fullHeight } = this.props;
    const msg = this.state.error?.message ?? 'An unexpected error occurred.';

    return (
      <div
        className="flex flex-col items-center justify-center gap-4 p-8 text-center"
        style={{
          minHeight:   fullHeight ? '100%' : 'auto',
          background:  'var(--tb-bg-base)',
          color:       'var(--tb-text-primary)',
        }}
      >
        {/* Icon */}
        <div
          className="flex items-center justify-center w-14 h-14 rounded-full"
          style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)' }}
        >
          <AlertTriangle className="w-7 h-7" style={{ color: '#f87171' }} />
        </div>

        {/* Heading */}
        <div>
          <p className="text-base font-semibold mb-1" style={{ color: 'var(--tb-text-primary)' }}>
            {label} crashed
          </p>
          <p className="text-sm max-w-sm" style={{ color: 'var(--tb-text-muted)' }}>
            Something went wrong while rendering this section.
          </p>
        </div>

        {/* Error detail — collapsed by default */}
        <details className="text-left max-w-sm w-full">
          <summary
            className="text-xs cursor-pointer select-none"
            style={{ color: 'var(--tb-text-muted)' }}
          >
            Show error details
          </summary>
          <pre
            className="mt-2 p-3 rounded-lg text-[11px] leading-relaxed overflow-auto"
            style={{
              background:  'var(--tb-bg-elevated)',
              color:       '#fca5a5',
              maxHeight:   160,
              whiteSpace:  'pre-wrap',
              wordBreak:   'break-all',
            }}
          >
            {msg}
          </pre>
        </details>

        {/* Reset button */}
        <button
          onClick={this.reset}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{
            background:   'var(--tb-bg-surface)',
            border:       '1px solid var(--tb-border)',
            color:        'var(--tb-text-secondary)',
            cursor:       'pointer',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--tb-bg-elevated)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--tb-bg-surface)'; }}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Try again
        </button>
      </div>
    );
  }
}
