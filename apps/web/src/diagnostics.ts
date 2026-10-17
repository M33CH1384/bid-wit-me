/**
 * Lightweight in-game diagnostics for asset/card load failures.
 * Today the game has no persisted error reporting: console output and ad-hoc window.__bwm*
 * test probes are all that exist, and nothing is sent anywhere. This buffer is the inspectable
 * middle ground (free tier, no services, no PII): load failures are counted and logged here,
 * readable in a console via window.__bwmDiag() and by tests. Entries are capped so a failing
 * asset loop can never grow memory without bound.
 */
export interface DiagEntry { t: number; kind: string; detail: string; count: number }

const MAX_ENTRIES = 100;
const entries: DiagEntry[] = [];
const byKey = new Map<string, DiagEntry>();

/** Record a load failure (deduplicated by kind+detail, with a repeat count). */
export function noteDiag(kind: string, detail: string): void {
  const key = `${kind}:${detail}`;
  const prev = byKey.get(key);
  if (prev) { prev.count++; prev.t = Date.now(); return; }
  const entry: DiagEntry = { t: Date.now(), kind, detail, count: 1 };
  byKey.set(key, entry);
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) { const dropped = entries.shift()!; byKey.delete(`${dropped.kind}:${dropped.detail}`); }
  try { console.warn(`[bwm-diag] ${kind}: ${detail}`); } catch { /* console is best-effort */ }
}

/** Snapshot of everything recorded so far (oldest first). */
export function getDiagnostics(): readonly DiagEntry[] { return entries; }

/** Total recorded failures including repeats. */
export function diagFailureCount(): number { return entries.reduce((a, e) => a + e.count, 0); }

export function resetDiagnostics(): void { entries.length = 0; byKey.clear(); }

// Inspectable from a console as window.__bwmDiag() (globalThis === window in the browser).
(globalThis as unknown as { __bwmDiag?: unknown }).__bwmDiag = () => ({ count: diagFailureCount(), entries: getDiagnostics().map((e) => ({ ...e })) });
