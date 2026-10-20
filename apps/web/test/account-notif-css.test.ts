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

/** Second failure mode, same section (owner, later on 2026-10-20: "I don't
 *  have an option to turn notifications on"). The restored rules above were
 *  all present, yet the expanded dropdown showed ONLY the blurb — the
 *  Enable button and iPhone note were clipped at the box's bottom edge.
 *  Root cause is a flexbox trap, not a missing rule: the sheet body
 *  (.acct-body in styles.css's .sheet-body) is a scrolling COLUMN FLEX
 *  container, and a flex item whose overflow is not visible gets an
 *  automatic minimum size of 0. .acct-dropdown (overflow: hidden for its
 *  rounded corners) was the only child allowed to shrink, so whenever the
 *  open sheet's content exceeded the sheet's 86dvh cap, the dropdown
 *  absorbed the overflow by shrinking and its own overflow: hidden clipped
 *  everything past the squeezed height — instead of the sheet scrolling.
 *  These pins keep the dropdown un-shrinkable and its body uncapped. */
describe('account.css cannot clip the expanded notifications dropdown', () => {
  it('the dropdown is flex: none — the scrolling sheet body may not shrink it', () => {
    const dd = rule('.acct-dropdown');
    expect(dd).toContain('flex: none');
    expect(dd).toContain('overflow: hidden'); // corner clipping stays; shrinking goes
  });
  it('the dropdown body carries no height cap, fixed height, or overflow clip', () => {
    const body = rule('.acct-dropdown-body');
    expect(body).not.toContain('max-height');
    expect(body).not.toContain('overflow');
    expect(body).not.toMatch(/[{;]\s*height:/);
  });
  it('the OFF branch markup keeps its turn-on control wired to enablePush', () => {
    expect(ui).toContain('data-testid="push-enable"');
    expect(ui).toContain('onClick={onEnable}');
    expect(ui).toContain('await enablePush()');
  });
});
