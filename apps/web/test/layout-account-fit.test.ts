/**
 * D4, account.css portion (design audit 2026-10-24): the 44px tap-target
 * floor for the account / sign-in controls. The census names are
 * descriptive; each row maps to the real shipped rule it measured
 * (grep-verified against AccountUI.tsx markup at master 09eb1273).
 * Sizes are parsed from the shipped CSS — a regression under 44 fails here.
 *
 *   census name              shipped rule (account.css)           was -> now
 *   -----------------------  -----------------------------------  ----------
 *   .acct-icon-btn (40)      .acct-chip (header account button)   40 -> 44
 *   .acct-small-btn (34)     .acct-small (Unlink/Remove/Change/   ~34 -> 44
 *                            Send test, padding-derived)
 *   passkey button (40)      .brand-btn.brand-passkey (main)      50 verified
 *                            .brand-btn.small (Add passkey row)   42 -> 44
 *   sheet close (28)         .sheet-close (styles.css rule, used  44 verified
 *                            by the account sheet head) — there
 *                            is no .acct-x/.sheet-x rule in
 *                            account scope at this commit
 *   provider buttons         .brand-btn (OAuth rows)              50 verified
 *
 * Found while grepping (same file, same floor):
 *   .acct-guest (Keep playing as guest / Later / Sign out /
 *     Cancel, padding-derived ~40) -> min-height 44
 *   .acct-danger (Delete account, ~39) -> min-height 44;
 *     .acct-danger.big (~48) verified, min-height pinned
 *   .acct-dropdown-head (Notifications head, ~43) -> min-height 44
 *   .acct-toast (tap-to-dismiss notice, ~40) -> min-height 44
 *   .acct-row-btn (~60), .acct-notif-row (~56), the username/body
 *     inputs (~50) were already >= 44 by padding+content; an explicit
 *     min-height now pins them so the floor is parseable, not implied.
 *
 * NOT targets (enumerated, deliberately unpinned): .acct-avatar.small
 * (28px avatar inside the 44px chip button), .acct-li-icon (34px
 * decorative span), .acct-switch (44x26 span inside the >=44 notif row;
 * its size is pinned by account-notif-css.test.ts), .acct-check (20px
 * status line, a <p>), and the inline fine-print links (.acct-fine a,
 * 13px prose links — flagged in the worker summary, not raised).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/account/account.css', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../src/account/AccountUI.tsx', import.meta.url), 'utf8');

/** Body of the rule for `sel`, preferring a line-start match so compound
 *  selectors never shadow the base rule (same idiom as layout-tapfloor-fit). */
const ruleIn = (src: string) => (sel: string) => {
  let i = src.indexOf('\n' + sel + ' {');
  if (i < 0) i = src.indexOf(sel + ' {');
  if (i < 0) throw new Error(`rule not found: ${sel}`);
  return src.slice(i, src.indexOf('}', i));
};
const rule = ruleIn(css);
const styleRule = ruleIn(styles);
const dim = (body: string, prop: string) => {
  const m = body.match(new RegExp(`(?<![-\\w])${prop}:\\s*(\\d+(?:\\.\\d+)?)px`));
  if (!m) throw new Error(`prop ${prop} not found in: ${body.slice(0, 80)}`);
  return parseFloat(m[1]!);
};

/** [selector, exact prop carrying the small axis] */
const FIXED: Array<[string, string]> = [
  ['.acct-chip', 'height'],
  ['.acct-small', 'min-height'],
  ['.brand-btn.small', 'min-height'],
  ['.acct-guest', 'min-height'],
  ['.acct-danger', 'min-height'],
  ['.acct-dropdown-head', 'min-height'],
  ['.acct-toast', 'min-height'],
];

const VERIFIED: Array<[string, string]> = [
  ['.brand-btn', 'min-height'], // OAuth provider rows + main passkey buttons: 50
  ['.acct-danger.big', 'min-height'],
  ['.acct-row-btn', 'min-height'],
  ['.acct-notif-row', 'min-height'],
  ['.acct-username input, .acct-body > input', 'min-height'],
];

describe('D4: account.css tap-target floor (44px)', () => {
  for (const [sel, prop] of [...FIXED, ...VERIFIED]) {
    it(`${sel} is at least 44 on its small axis (${prop})`, () => {
      expect(dim(rule(sel), prop)).toBeGreaterThanOrEqual(44);
    });
  }

  it('provider rows keep their verified 50px (SignInSheet budget)', () => {
    expect(dim(rule('.brand-btn'), 'min-height')).toBe(50);
  });

  it('the account sheet close is the shared .sheet-close, already 44 in styles.css', () => {
    // AccountUI renders the sheet head close with class "sheet-close";
    // no account-scoped close rule (.acct-x / .sheet-x) exists in account.css.
    expect(ui).toContain('className="sheet-close"');
    expect(css).not.toContain('.acct-x');
    expect(dim(styleRule('.sheet-close'), 'min-height')).toBeGreaterThanOrEqual(44);
  });

  it('the markup still renders the fixed controls (guard against inverse drift)', () => {
    for (const cls of ['acct-chip', 'acct-small', 'brand-btn small', 'acct-guest', 'acct-danger', 'acct-dropdown-head', 'acct-toast']) {
      expect(ui).toContain(cls);
    }
  });
});
