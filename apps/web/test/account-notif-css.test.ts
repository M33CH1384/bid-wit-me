/** Account notifications CSS coverage (regression, Demetrius 2026-10-20:
 *  "the notification section settings aren't usable now after the latest
 *  updates"). Root cause: commit f28a3759 rewrote account.css to add the
 *  collapsible Notifications dropdown and, in the same whole-file rewrite,
 *  dropped the styles AccountUI.tsx still renders — the per-type preference
 *  rows (.acct-notifs / .acct-notif-row / .acct-switch) and the row-button
 *  family (.acct-row-btn / .acct-row-text / .acct-row-chev, used by the
 *  Sign-in & security row and by the preference rows' text). With no rules,
 *  each preference toggle rendered as a bare native button: the switch span
 *  was zero-size (invisible) and neither state readout (.off dimming, .on
 *  violet track + slid knob) existed, so the settings could not be read or
 *  operated as switches. The JS handlers were never broken.
 *
 *  These pins tie every class the account markup relies on to a rule in
 *  account.css, so a future whole-file rewrite that drops one fails CI. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/account/account.css', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../src/account/AccountUI.tsx', import.meta.url), 'utf8');

/** The rule body for an exact selector (first match), or '' when absent. */
const rule = (selector: string) => {
  const i = css.indexOf(`${selector} {`);
  if (i < 0) return '';
  return css.slice(i, css.indexOf('}', i));
};

describe('account.css covers every class the notifications markup renders', () => {
  it('the markup still uses the classes (guard against the inverse drift)', () => {
    for (const cls of ['acct-notifs', 'acct-notif-row', 'acct-switch', 'acct-notif-acts', 'acct-row-btn', 'acct-row-text', 'acct-row-chev']) {
      expect(ui).toContain(cls);
    }
  });
  it('preference rows are full-width flex rows, dimmed when off', () => {
    const row = rule('.acct-notif-row');
    expect(row).toContain('display: flex');
    expect(row).toContain('width: 100%');
    expect(rule('.acct-notif-row.off')).toContain('opacity: .55');
    expect(rule('.acct-notifs')).toContain('display: flex');
    expect(rule('.acct-notif-acts')).toContain('display: flex');
  });
  it('the switch has a real track, a knob, and a distinct on state', () => {
    const sw = rule('.acct-switch');
    expect(sw).toContain('width: 44px');
    expect(sw).toContain('height: 26px');
    expect(sw).toContain('border-radius: 999px');
    expect(sw).toContain('position: relative');
    const knob = rule('.acct-switch::after');
    expect(knob).toContain('width: 20px');
    expect(knob).toContain('border-radius: 50%');
    expect(rule('.acct-switch.on')).toContain('background: #7c3aed');
    expect(rule('.acct-switch.on::after')).toContain('left: 21px');
  });
  it('the row-button family behind Sign-in & security is styled too', () => {
    const btn = rule('.acct-row-btn');
    expect(btn).toContain('display: flex');
    expect(btn).toContain('width: 100%');
    expect(rule('.acct-row-text')).toContain('display: flex');
    expect(rule('.acct-row-chev')).toContain('color: var(--gold)');
  });
});
