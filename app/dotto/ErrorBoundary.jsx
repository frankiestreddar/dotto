"use client";

import { Component } from "react";

// A crash in any ONE of these small, independent React-owned pieces (see dotto-app.jsx, every
// <ErrorBoundary> wrapping a single sibling) no longer takes the ENTIRE app down with it. Without
// this, React's own behavior on an uncaught render/layout-effect error with no boundary anywhere
// in the tree is to unmount the WHOLE root — exactly what happened for both the Title/Watermark
// first-mount crash and the window.__initials race (see their own fix commits). Neither bug was
// itself in shared code, but with no boundary, an error in one small piece (a single card kind,
// one profile avatar) silently took out completely unrelated ones (ProfilePanel, MessagesPanel)
// too, which is what made both bugs confusing to diagnose from the reported symptoms alone.
//
// componentDidCatch only logs — there's no user-facing fallback UI by design: these components are
// all invisible-unless-active overlays/panels/portals (a notification bar, a dropdown panel, ...),
// so the correct "fallback" for most of them is simply "nothing visible," which returning null
// already achieves. A future pass could render a small inline error indicator for panels where
// "silently disappears" would be confusing (e.g. the canvas item layer) — not attempted here, this
// is deliberately the minimal safety net, not a polished error-UI pass.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error(
      `[ErrorBoundary${this.props.name ? ` ${this.props.name}` : ""}] caught:`,
      error,
      info,
    );
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
