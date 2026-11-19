import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'An unexpected error occurred.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Application Error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      let friendly = this.state.message;
      try {
        const parsed = JSON.parse(this.state.message) as { error?: string; operationType?: string };
        if (parsed?.error) {
          friendly = `${parsed.operationType ? `${parsed.operationType.toUpperCase()} error: ` : ''}${parsed.error}`;
        }
      } catch {
        // Not JSON
      }

      return (
        <main className="grid min-h-screen place-items-center bg-canvas px-4 text-ink">
          <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 text-center shadow-xl">
            <h1 className="font-display text-xl font-bold text-ink">Something went wrong</h1>
            <p className="mt-2 break-words text-xs leading-relaxed text-muted">{friendly}</p>
            <div className="mt-5 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-ink"
              >
                Reload Page
              </button>
              <a
                href="/home"
                className="rounded-lg border border-line bg-canvas px-4 py-2 text-xs font-semibold text-ink hover:border-accent/50"
              >
                Go Home
              </a>
            </div>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}
