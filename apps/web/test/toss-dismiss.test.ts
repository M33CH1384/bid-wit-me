/**
 * @vitest-environment happy-dom
 *
 * TOSS PILL DISMISS (owner, 2026-11-07): "The toss the hand button should
 * have an x so people can quickly dismiss it if they'd like."
 *
 * Locked semantics (owner-approved shape; the dismissal is NOT a poll
 * opt-out):
 *  - the ✕ hides the pill for THIS player only, for the REST OF THE
 *    CURRENT HAND — local UI state keyed to the hand (seed + hand
 *    number), never sent to the server, never affecting anyone else;
 *  - a new hand restores the pill as normal;
 *  - if another player calls a toss, the vote sheet still reaches the
 *    dismisser exactly as today — dismissal is never consulted there;
 *  - the ✕ tap must NEVER trigger the call (stopPropagation).
 * The final-trick suppression (≤1 trick: no pill at all) is untouched —
 * there is nothing to dismiss there; the existing toss suites hold it.
 */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TossButton } from '../src/Table';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tableSrc = readFileSync('apps/web/src/Table.tsx', 'utf8');
const css = readFileSync('apps/web/src/styles.css', 'utf8');

describe('TossButton — the pill and its dismiss ✕', () => {
  let el: HTMLDivElement;
  let root: Root;

  async function render(onCall: () => void, onDismiss: () => void) {
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => { root.render(createElement(TossButton, { onCall, onDismiss })); });
    return el;
  }

  afterEach(async () => {
    if (root) await act(async () => { root.unmount(); });
    el?.remove();
  });

  it('renders the call pill and a distinct ✕ with an accessible name', async () => {
    const onCall = vi.fn(); const onDismiss = vi.fn();
    const c = await render(onCall, onDismiss);
    const pill = c.querySelector('[data-testid="toss-call"]');
    const x = c.querySelector('[data-testid="toss-dismiss"]') as HTMLButtonElement | null;
    expect(pill).not.toBeNull();
    expect(pill!.textContent).toContain('Toss the hand?');
    expect(x).not.toBeNull();
    expect(x!.getAttribute('aria-label')).toBe('Dismiss');
    expect(x).not.toBe(pill); // its own control, never part of the call button
  });

  it('tapping ✕ dismisses — and NEVER fires the call', async () => {
    const onCall = vi.fn(); const onDismiss = vi.fn();
    const c = await render(onCall, onDismiss);
    const x = c.querySelector('[data-testid="toss-dismiss"]') as HTMLButtonElement;
    await act(async () => { x.click(); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onCall).not.toHaveBeenCalled();
  });

  it('tapping the pill still calls — and does not dismiss', async () => {
    const onCall = vi.fn(); const onDismiss = vi.fn();
    const c = await render(onCall, onDismiss);
    const pill = c.querySelector('[data-testid="toss-call"]') as HTMLButtonElement;
    await act(async () => { pill.click(); });
    expect(onCall).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('the ✕ is an honest tap target (≥32px from the shipped CSS)', () => {
    const rule = css.match(/\.toss-dismiss \{[^}]*\}/)?.[0] ?? '';
    expect(rule).not.toBe('');
    const w = Number(rule.match(/width: (\d+)px/)?.[1] ?? 0);
    const h = Number(rule.match(/height: (\d+)px/)?.[1] ?? 0);
    expect(w).toBeGreaterThanOrEqual(32);
    expect(h).toBeGreaterThanOrEqual(32);
  });
});

describe('dismissal wiring (source pins)', () => {
  it('dismissal is per-hand state: a seed + hand-number key, starting undismissed', () => {
    expect(tableSrc).toContain('const [tossDismissedHand, setTossDismissedHand] = useState<string | null>(null);');
    // the gate compares against the CURRENT hand's key — a new hand
    // (new handNo, or a new game seed) simply never matches the old key
    expect(tableSrc).toContain('tossDismissedHand !== `${seed}:${st.handNo}`');
  });

  it('the state is read ONLY by the pill gate — the vote sheets never consult it', () => {
    const reads = tableSrc.split('\n').filter((l) => l.includes('tossDismissedHand'));
    // exactly: the declaration line + the canToss gate line
    expect(reads.length).toBe(2);
    const sheet = tableSrc.slice(tableSrc.indexOf('function TossSheet'), tableSrc.indexOf('function TableGame'));
    expect(sheet).not.toContain('tossDismissed');
    // both vote-sheet render paths (offline sheet + online poll) ignore it
    const renders = tableSrc.slice(tableSrc.indexOf('if (!online && tossSheet'), tableSrc.indexOf('if (online && tossPoll)') + 6000);
    expect(renders).not.toContain('tossDismissed');
  });

  it('the online call itself is unchanged — dismissal sends nothing anywhere', () => {
    expect(tableSrc).toContain('if (online) online.toss!.call(); else setTossSheet(true);');
    // the dismiss handler only records the current hand's key locally
    expect(tableSrc).toContain('onDismiss={() => setTossDismissedHand(`${seed}:${st.handNo}`)}');
  });
});
