import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary] Caught error:', error);
      console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);
    }
    this.props.onError?.(error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          gap: '0.75rem',
          height: '100%',
          color: 'var(--text-muted, #888)',
          fontSize: '0.875rem',
          textAlign: 'center',
        }}>
          <div style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--text-primary, #ccc)' }}>
            Something went wrong
          </div>
          {this.state.error && (
            <div style={{
              maxWidth: '400px',
              wordBreak: 'break-word',
              fontFamily: 'monospace',
              fontSize: '0.8rem',
              opacity: 0.7,
            }}>
              {this.state.error.message}
            </div>
          )}
          <button
            onClick={this.handleReset}
            style={{
              marginTop: '0.5rem',
              padding: '0.4rem 1rem',
              border: '1px solid var(--border-color, #444)',
              borderRadius: '4px',
              background: 'var(--bg-secondary, #2a2a2a)',
              color: 'var(--text-primary, #ccc)',
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
