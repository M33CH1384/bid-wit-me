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

/** localStorage key holding the timestamp of a boot that followed a process
 *  death (an unclean exit witnessed by telemetry at startup). The mark is
 *  written by telemetry's previous-session witness and consumed exactly once
 *  by the audio engine on the first unlock gesture of the resumed page, so a
 *  session that began as a crash-resume gets one deliberate graph rebuild —
 *  rebinding the iOS audio session, which no in-graph meter can prove dead
 *  after a jetsam kill (see audio.ts healCrashResumedAudio). Storage is
 *  best-effort: private-mode failures simply lose the heal, never the boot. */
export const UNCLEAN_BOOT_AT_KEY = 'bwm.uncleanBootAt';

/** Record that this boot follows a process death (called at startup). */
export function markUncleanBoot(at: number = Date.now()): void {
  try { localStorage.setItem(UNCLEAN_BOOT_AT_KEY, String(at)); } catch { /* best-effort */ }
}

/** Read-and-clear the unclean-boot mark. Returns the death-witness timestamp
 *  when it is no older than maxAgeMs, otherwise null (absent, corrupt, or
 *  stale marks are all cleared — a mark must never outlive its session). */
export function consumeUncleanBoot(maxAgeMs: number): number | null {
  try {
    const raw = localStorage.getItem(UNCLEAN_BOOT_AT_KEY);
    if (raw === null) return null;
    localStorage.removeItem(UNCLEAN_BOOT_AT_KEY);
    const at = Number(raw);
    if (!Number.isFinite(at) || at <= 0) return null;
    const age = Date.now() - at;
    return age >= 0 && age <= maxAgeMs ? at : null;
  } catch { return null; }
}

// Inspectable from a console as window.__bwmDiag() (globalThis === window in the browser).
(globalThis as unknown as { __bwmDiag?: unknown }).__bwmDiag = () => ({ count: diagFailureCount(), entries: getDiagnostics().map((e) => ({ ...e })) });
