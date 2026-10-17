import { Component, type ReactNode } from "react";

interface Props {
  label: string;
  children: ReactNode;
}

/** Contain a failed panel so the remaining route information stays usable. */
export class PanelErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="panel-error" role="alert" aria-label={`${this.props.label} error`}>
          <p>This panel hit a problem ·</p>
          <button
            className="button secondary"
            onClick={() => this.setState({ failed: false })}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
