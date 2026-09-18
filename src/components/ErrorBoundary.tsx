import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  label: string;
}

interface State {
  error: string | null;
}

/**
 * Last-resort crash containment: a third-party embed (or any render bug)
 * must never blank the entire app again. Shows a recoverable panel.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(err: unknown): State {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  componentDidCatch(): void {
    // Intentionally silent: the panel itself is the report.
  }

  render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <div className="error-banner" role="alert" data-testid="app-crash">
          <strong>Something went wrong in {this.props.label}.</strong>
          <span>{this.state.error}</span>
          <button
            className="btn"
            onClick={() => this.setState({ error: null })}
            data-testid="app-crash-reset"
          >
            Dismiss
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
