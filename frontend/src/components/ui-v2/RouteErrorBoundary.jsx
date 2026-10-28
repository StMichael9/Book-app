import { Component } from "react";
import { reportError } from "../../observability.js";
import { ActionLink, Button, EmptyState } from "./primitives.jsx";

// A page that throws while rendering would otherwise take the whole app to a blank screen. This keeps the header and
// navigation, offers a way out, and clears itself as soon as the reader goes somewhere else (resetKey changes).
export default class RouteErrorBoundary extends Component {
  state = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  // Going to another page (a new resetKey) clears the failure.
  static getDerivedStateFromProps(props, state) {
    return props.resetKey !== state.resetKey ? { failed: false, resetKey: props.resetKey } : null;
  }

  componentDidCatch(error, info) {
    reportError(error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <section className="bv-container">
      <EmptyState error title="Something went wrong on this page." action={<>
        <ActionLink to="/browse">Discover books</ActionLink>
        <Button variant="secondary" onClick={() => window.location.reload()}>Reload</Button>
      </>}>Your books and notes haven’t changed. Try reloading, or go somewhere else.</EmptyState>
    </section>;
  }
}
