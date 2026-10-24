/**
 * @vitest-environment happy-dom
 *
 * Daily-bonus receipt (owner report, 2026-10-23): "I got a notification for
 * daily coins and tapped it and the app opened up to the profile screen
 * without any notification signifying how many I got or how many I had."
 * The grant is automatic (server dailyLogin on the first /api/profile/me
 * read of the day); the payload now reports the grant it performed, and
 * these tests pin the receipt: it renders the server's amount + resulting
 * balance, fires once per grant (per UTC day), stays silent for every
 * other payload, and never invents a balance the payload didn't carry.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import DailyBonusReceipt from '../src/DailyBonusReceipt';
import { dismissDailyBonus, noteDailyBonus } from '../src/dailyBonus';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const grantPayload = (over: Record<string, unknown> = {}) => ({
  dailyBonus: { granted: true, amount: 250, streak: 3, day: '2026-10-23' },
  coins: { balance: 1250 },
  ...over,
});

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  dismissDailyBonus();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root.render(createElement(DailyBonusReceipt)); });
});
afterEach(() => {
  act(() => { root.unmount(); });
  host.remove();
  dismissDailyBonus();
  localStorage.clear();
});

const receipt = () => host.querySelector('[data-testid="daily-bonus-receipt"]');

describe('daily bonus receipt', () => {
  it('shows the granted amount and the resulting balance from the payload', () => {
    act(() => noteDailyBonus(grantPayload()));
    const el = receipt();
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain('+250 coins — Daily bonus');
    expect(el!.textContent).toContain('You now have 1,250 coins.');
    expect(el!.textContent).toContain('3-day streak.');
  });

  it('ignores non-granting reads and unrelated payloads', () => {
    act(() => noteDailyBonus({ dailyBonus: { granted: false, amount: 0, streak: 1, day: '2026-10-23' }, coins: { balance: 1000 } }));
    expect(receipt()).toBeNull();
    act(() => noteDailyBonus({ coins: { balance: 1000 } })); // no grant field (public/other payloads)
    expect(receipt()).toBeNull();
    act(() => noteDailyBonus({ type: 'dm', text: 'hello' })); // another notification kind's shape
    expect(receipt()).toBeNull();
    act(() => noteDailyBonus(null));
    expect(receipt()).toBeNull();
  });

  it('fires once per grant: the same day never re-shows, the next day does', () => {
    act(() => noteDailyBonus(grantPayload()));
    expect(receipt()).not.toBeNull();
    act(() => { dismissDailyBonus(); });
    expect(receipt()).toBeNull();
    // a second consumer re-noting the same granting payload must not re-toast
    act(() => noteDailyBonus(grantPayload()));
    expect(receipt()).toBeNull();
    // tomorrow's grant is a new day and receipts afresh, with its own numbers
    act(() => noteDailyBonus(grantPayload({
      dailyBonus: { granted: true, amount: 100, streak: 1, day: '2026-10-24' },
      coins: { balance: 1350 },
    })));
    const el = receipt();
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain('+100 coins — Daily bonus');
    expect(el!.textContent).toContain('You now have 1,350 coins.');
    expect(el!.textContent).not.toContain('streak');
  });

  it('dismisses from the ✕ button', () => {
    act(() => noteDailyBonus(grantPayload()));
    const btn = host.querySelector<HTMLButtonElement>('.dbr-x');
    expect(btn).not.toBeNull();
    act(() => { btn!.click(); });
    expect(receipt()).toBeNull();
  });

  it('shows the grant alone when the payload carries no balance (never a guessed total)', () => {
    act(() => noteDailyBonus({ dailyBonus: { granted: true, amount: 100, streak: 1, day: '2026-10-25' } }));
    const el = receipt();
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain('+100 coins — Daily bonus');
    expect(el!.textContent).not.toContain('You now have');
  });
});

describe('daily bonus wiring pins', () => {
  const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  it('the /me payload carries the grant report (server)', () => {
    expect(src('../../server/src/cred/routes.ts')).toContain('dailyBonus');
  });
  it('every /api/profile/me consumer receipts a granting read', () => {
    expect(src('../src/profile/ProfileView.tsx')).toContain('noteDailyBonus(cred)');
    expect(src('../src/venues.ts')).toContain('noteDailyBonus(p)');
    expect(src('../src/social/wagerApi.ts')).toContain('noteDailyBonus(j)');
    expect(src('../src/social/Compete.tsx')).toContain('noteDailyBonus(j)');
  });
  it('the receipt is mounted at the root', () => {
    expect(src('../src/main.tsx')).toContain('<DailyBonusReceipt />');
  });
});
