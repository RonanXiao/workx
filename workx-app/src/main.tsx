import ReactDOM from "react-dom/client";
import { Component, type ErrorInfo, type ReactNode } from "react";
import App from "./App";

interface BoundaryState {
  error: string | null;
  stack: string | null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null, stack: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error: String(error), stack: null };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("Workx desktop render error:", error, info);
    this.setState({ stack: info.componentStack ?? null });
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: "monospace", color: "white", background: "#111" }}>
          <h2>Workx Desktop render error</h2>
          <pre style={{ whiteSpace: "pre-wrap" }}>{this.state.error}</pre>
          {this.state.stack && <pre style={{ whiteSpace: "pre-wrap", color: "#89b" }}>{this.state.stack}</pre>}
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
