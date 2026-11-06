/**
 * LayerGuard — an error boundary for the app's globally mounted layers
 * (crash hardening, 2026-11-06).
 *
 * main.tsx mounts a dozen layers OUTSIDE the routed tree: Social, the
 * league ticker, the transition layers, the entry flow, and more. The
 * RouteGuard boundary only covers routed screens, so a single render
 * throw in any global layer unmounted the entire React root — the
 * player got a white screen and lost the table, the menu, everything.
 *
 * A LayerGuard contains its subtree instead: the failure is reported
 * through the same 'boundary' telemetry kind the RouteGuard uses, the
 * layer renders its fallback (default: nothing — most layers are
 * decorative and their absence is invisible), and every other layer
 * and the game itself keep running. `retry` remounts the subtree
 * fresh; interactive layers (Social) pass a fallback that offers it.
 *
 * Boundaries catch render/lifecycle throws only — asynchronous and
 * animation-frame errors are handled where they live (telemetry's
 * window handlers observe them; effect hosts contain them).
 */
import { Component, Fragment, type ReactNode } from 'react';
import { reportCrash } from './telemetry';

export interface LayerGuardProps {
  /** Layer name for telemetry ('social', 'ticker', …). */
  name: string;
  /** Fallback node, or a render function receiving the retry callback. */
  fallback?: ReactNode | ((retry: () => void) => ReactNode);
  children: ReactNode;
}

interface LayerGuardState { failed: boolean; epoch: number }

export class LayerGuard extends Component<LayerGuardProps, LayerGuardState> {
  override state: LayerGuardState = { failed: false, epoch: 0 };

  static getDerivedStateFromError(): Partial<LayerGuardState> { return { failed: true }; }

  override componentDidCatch(err: unknown): void {
    reportCrash('boundary', err, { layer: this.props.name, route: location.pathname });
  }

  retry = (): void => { this.setState((s) => ({ failed: false, epoch: s.epoch + 1 })); };

  override render(): ReactNode {
    if (!this.state.failed) {
      // The key remounts the subtree from scratch when retry bumps the epoch.
      return <Fragment key={this.state.epoch}>{this.props.children}</Fragment>;
    }
    const fb = this.props.fallback;
    if (typeof fb === 'function') return (fb as (retry: () => void) => ReactNode)(this.retry);
    return fb ?? null;
  }
}
