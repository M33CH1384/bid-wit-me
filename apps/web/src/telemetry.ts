/**
 * Crash / error telemetry — the game's first persisted error reporting.
 *
 * Until now a player's crash left no trace anywhere: no window.onerror
 * reporter, no server table, nothing to review. Diagnosis ran on verbal
 * reports ("it kicked me back to the menu") days after the fact. This module
 * is the fix: a tiny framework-free reporter installed at boot (main.tsx,
 * before the route tree) that posts a capped, deduped report to
 * POST /api/crashes (same-origin through the Pages proxy, so the session
 * cookie rides and the server can attach the account id it already knows).
 *
 * What is captured, as first-class kinds:
 *   error / rejection   — window 'error' + 'unhandledrejection'
 *   boundary            — the route error boundary's catch (main.tsx RouteGuard)
 *   chunk               — a dynamic-import failure that outlived chunkLoad's
 *                         cache-bust retries (the 2026-10-22/23 bounce family)
 *   webgl-lost/restored — the table canvas losing its GPU context (Scene.tsx);
 *                         memory pressure's canary, previously unobserved
 *   conn-close          — a terminal table-socket close (4000/4003) that ends
 *                         a seated session with no reconnect (connection.ts)
 *   unclean-exit        — witness report: the PREVIOUS session ended while at
 *                         a table with no clean exit and no pagehide — the
 *                         signature of process death (jetsam), which by
 *                         definition can never report itself
 *   manual              — a deliberate report (support / probes)
 *
 * Every report carries a breadcrumb ring: route changes, connection status
 * transitions, Scene mount/unmount, visibility changes — plus the noteDiag
 * failure stream (diagnostics.ts) and the feedback context snapshot
 * (feedbackContext.ts: build, viewport, table code, live game line). The
 * table screen already keeps that snapshot current; Scene adds venue /
 * quality / story-stop through setCrashContext.
 *
 * Hard rules: this module can NEVER throw into the app (every entry point is
 * wrapped; a telemetry failure is silent — a reporter that breaks its own
 * error path is worse than none), it is capped (12 sends per session,
 * per-kind+message dedupe for 60 s, payload trimmed to the server's caps),
 * and it sends no gameplay PII — the account id is resolved server-side
 * from the session cookie, never sent by the client.
 */
import { getDiagnostics } from './diagnostics';
import { VERSION } from './version';
import { feedbackContext } from './feedbackContext';

export type CrashKind =
  | 'error' | 'rejection' | 'boundary' | 'chunk'
  | 'webgl-lost' | 'webgl-restored' | 'conn-close'
  | 'unclean-exit' | 'manual';

export interface Crumb { t: number; label: string; detail: string }

const ENDPOINT = '/api/crashes';
const MAX_SENDS_PER_SESSION = 12;
const DEDUPE_MS = 60_000;
const MIN_SEND_GAP_MS = 3_000;
const MAX_CRUMBS = 40;
const MAX_MESSAGE = 500;
const MAX_STACK_LINES = 12;
const WATCH_KEY = 'bwm.crash.watch';

const crumbs: Crumb[] = [];
const sentAt = new Map<string, number>();
let sentCount = 0;
let installed = false;
let lastSendAt = 0;
let pending: string | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let extraContext: Record<string, unknown> = {};

/* ------------------------------------------------------------ breadcrumbs */

/** Append to the breadcrumb ring (capped, oldest dropped). Never throws. */
export function noteCrumb(label: string, detail = ''): void {
  try {
    crumbs.push({ t: Date.now(), label: String(label).slice(0, 40), detail: String(detail).slice(0, 120) });
    if (crumbs.length > MAX_CRUMBS) crumbs.splice(0, crumbs.length - MAX_CRUMBS);
    if (label === 'scene-mount') setWatch({ atTable: true, route: safePath(), suspendedClean: false });
    if (label === 'scene-unmount') setWatch({ atTable: false, suspendedClean: false });
  } catch { /* breadcrumbs are best-effort */ }
}

export function getCrashCrumbs(): readonly Crumb[] { return crumbs; }

/** Coarse scene context the next report should carry (venue, quality, story stop…). */
export function setCrashContext(patch: Record<string, unknown>): void {
  try { extraContext = { ...extraContext, ...patch }; } catch { /* best-effort */ }
}

/* ------------------------------------------------- unclean-exit witness */

interface Watch { atTable: boolean; route: string; build: string; ts: number; suspendedClean: boolean }

function safePath(): string {
  try { return location.pathname; } catch { return ''; }
}

function loadWatch(): Watch | null {
  try {
    const raw = localStorage.getItem(WATCH_KEY);
    if (!raw) return null;
    const w = JSON.parse(raw) as Watch;
    return typeof w === 'object' && w !== null && typeof w.ts === 'number' ? w : null;
  } catch { return null; }
}

function setWatch(patch: Partial<Watch>): void {
  try {
    const prev = loadWatch() ?? { atTable: false, route: safePath(), build: VERSION.sha, ts: Date.now(), suspendedClean: false };
    localStorage.setItem(WATCH_KEY, JSON.stringify({ ...prev, ...patch, build: VERSION.sha, ts: Date.now() }));
  } catch { /* private mode: the witness is a bonus, never a blocker */ }
}

/** If the previous session died at a table, say so — once, on the next boot. */
function witnessPreviousSession(): void {
  const prev = loadWatch();
  setWatch({ atTable: false, route: safePath(), suspendedClean: false });
  if (!prev || !prev.atTable || prev.suspendedClean) return;
  if (Date.now() - prev.ts > 7 * 24 * 3600_000) return; // a stale flag is not evidence
  reportCrash('unclean-exit', new Error('previous session ended at a table with no clean exit and no pagehide — process death suspected'), {
    prevRoute: prev.route, prevBuild: prev.build, prevAgeSec: Math.round((Date.now() - prev.ts) / 1000),
  });
}

/* ------------------------------------------------------------- transport */

function scheduleSend(body: string): void {
  const wait = lastSendAt + MIN_SEND_GAP_MS - Date.now();
  if (wait <= 0 && !pendingTimer) { flushSend(body); return; }
  pending = body; // newest wins: a crash burst collapses to its latest report
  if (!pendingTimer) {
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      const b = pending; pending = null;
      if (b) flushSend(b);
    }, Math.max(0, wait));
  }
}

function flushSend(body: string): void {
  lastSendAt = Date.now();
  try {
    const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function'
      && navigator.sendBeacon(ENDPOINT, blob)) return;
  } catch { /* fall through to fetch */ }
  try {
    void fetch(ENDPOINT, { method: 'POST', keepalive: true, headers: { 'content-type': 'text/plain;charset=UTF-8' }, body })
      .catch(() => undefined);
  } catch { /* telemetry failure is silent by design */ }
}

/* --------------------------------------------------------------- reports */

function trimStack(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  const lines = stack.split('\n').slice(0, MAX_STACK_LINES).join('\n');
  return lines.slice(0, 4000);
}

function buildPayload(kind: CrashKind, err: unknown, extra: Record<string, unknown>): Record<string, unknown> {
  const message = (err instanceof Error ? err.message : String(err ?? kind)).slice(0, MAX_MESSAGE);
  let context: Record<string, unknown> = {};
  try {
    const fc = feedbackContext() as Record<string, unknown>;
    // Coarse game line only (mode / phase / hand / table size) — crash triage
    // needs where the game was, never the cards or the score.
    const g = fc.game as Record<string, unknown> | null;
    context = {
      version: fc.version, platform: fc.platform, viewport: fc.viewport, touch: fc.touch,
      online: fc.online, table: fc.table,
      game: g ? { mode: g.mode, players: g.players, phase: g.phase, hand: g.hand, online: g.online } : null,
      ...extraContext,
      diag: getDiagnostics().slice(-20).map((d) => ({ kind: d.kind, detail: d.detail.slice(0, 120), count: d.count })),
    };
  } catch { /* context is garnish; the report itself must still go out */ }
  return {
    kind,
    message,
    stack: trimStack(err instanceof Error ? err.stack : undefined),
    route: safePath(),
    build: VERSION.sha,
    context,
    crumbs: [...crumbs],
    extra,
    ua: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 300) : '',
    ts: Date.now(),
  };
}

/**
 * Report one crash/error event. Deduped per kind+message for 60 s and capped
 * per session. Never throws, never returns a promise the caller must handle.
 */
export function reportCrash(kind: CrashKind, err: unknown, extra: Record<string, unknown> = {}): void {
  try {
    if (sentCount >= MAX_SENDS_PER_SESSION) return;
    const message = err instanceof Error ? err.message : String(err ?? kind);
    const key = `${kind}:${message.slice(0, 120)}`;
    const now = Date.now();
    if (now - (sentAt.get(key) ?? 0) < DEDUPE_MS) return;
    sentAt.set(key, now);
    sentCount++;
    noteCrumb('report', `${kind}: ${message.slice(0, 80)}`);
    scheduleSend(JSON.stringify(buildPayload(kind, err, extra)));
  } catch { /* telemetry must never throw into the app */ }
}

/* ----------------------------------------------------------------- boot */

/**
 * Install the global handlers + the previous-session witness. Call once, at
 * app boot, before the route tree renders (main.tsx). Safe to call again.
 */
export function installCrashTelemetry(): void {
  if (installed) return;
  installed = true;
  try { witnessPreviousSession(); } catch { /* witness is best-effort */ }
  try {
    window.addEventListener('error', (ev) => {
      try {
        reportCrash('error', ev.error ?? ev.message ?? 'window error', {
          filename: ev.filename ?? '', lineno: ev.lineno ?? 0, colno: ev.colno ?? 0,
        });
      } catch { /* never throw from a handler */ }
    });
    window.addEventListener('unhandledrejection', (ev) => {
      try { reportCrash('rejection', ev.reason ?? 'unhandled rejection'); } catch { /* never throw */ }
    });
    document.addEventListener('visibilitychange', () => {
      try { noteCrumb('visibility', document.visibilityState); } catch { /* best-effort */ }
    });
    window.addEventListener('pagehide', () => {
      // The page got a proper goodbye (closed, navigated, or backgrounded
      // through the OS path): whatever happens to the process later is not
      // a mid-table death. A FOREGROUND process kill — the crash shape this
      // witness exists for — never fires pagehide.
      try { setWatch({ suspendedClean: true }); } catch { /* best-effort */ }
    });
    noteCrumb('boot', safePath());
  } catch { /* a reporter that fails to install must not take the app with it */ }
}

/** Test hooks / console probe, mirroring the __bwmDiag precedent. */
export const crashTestHooks = {
  reportCrash, noteCrumb, getCrashCrumbs,
  reset(): void { crumbs.length = 0; sentAt.clear(); sentCount = 0; lastSendAt = 0; pending = null; },
};
(globalThis as unknown as { __bwmCrash?: unknown }).__bwmCrash = (kind?: CrashKind, message?: string) =>
  reportCrash(kind ?? 'manual', new Error(message ?? 'manual crash probe'));
