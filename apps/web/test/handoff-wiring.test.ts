/**
 * Wiring pins for the app-shell sign-in handoff: the feature spans four codebases'
 * worth of surfaces (server routes + migration, account client, sign-in sheet,
 * router, native shell) and every joint is a string two sides must agree on.
 * These pins read the sources (same style as app-icons.test.ts) so a rename on
 * one side fails here instead of silently breaking sign-in in the app.
 */
import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const readRepo = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

describe('handoff wiring', () => {
  it('server: routes.ts serves mint + redeem behind the shell gate, migration exists', () => {
    const routes = readRepo('apps/server/src/auth/routes.ts');
    expect(routes).toContain("a === 'handoff'");
    expect(routes).toContain('handoff_codes');
    expect(routes).toContain('SHELL_UA_MARKER');
    expect(existsSync(new URL('../../../apps/server/migrations/0039_handoff_codes.sql', import.meta.url))).toBe(true);
  });

  it('client: api.ts redeems inside loadAccount and exposes mint + manual redeem', () => {
    const api = read('../src/account/api.ts');
    expect(api).toContain('handoffCodeFromSearch');
    expect(api).toContain("'handoff/redeem'");
    expect(api).toContain("'handoff/mint'");
    expect(api).toContain('mintHandoffCode');
    expect(api).toContain('redeemHandoffCode');
  });

  it('sign-in sheet: the shell gets the handoff button + typed-code form; the create-account button is shell-gated', () => {
    const ui = read('../src/account/AccountUI.tsx');
    expect(ui).toContain('data-testid="signin-handoff"');
    expect(ui).toContain('data-testid="handoff-code-input"');
    expect(ui).toContain('inAppShell');
    // the passkey-new (create account) button must sit inside the non-shell branch
    const shellBranch = ui.indexOf('data-testid="signin-handoff"');
    const createBtn = ui.indexOf('data-testid="create-passkey"');
    expect(shellBranch).toBeGreaterThan(-1);
    expect(createBtn).toBeGreaterThan(shellBranch);
  });

  it('router: /auth/handoff renders the standalone mint page', () => {
    const main = read('../src/main.tsx');
    expect(main).toContain("'/auth/handoff'");
    expect(main).toContain('HandoffPage');
  });

  it('mint page: offers passkey sign-in and the app return, and never a create-account path', () => {
    const page = read('../src/account/HandoffPage.tsx');
    expect(page).toContain('passkeySignIn');
    expect(page).toContain('return-to-app');
    expect(page.toLowerCase()).not.toContain('create an account with a passkey');
    expect(page).not.toContain('passkeyRegister');
  });

  it('the UA marker agrees across web, server and the native patch', () => {
    const web = read('../src/account/handoff.ts');
    const routes = readRepo('apps/server/src/auth/routes.ts');
    expect(web).toContain("SHELL_UA_MARKER = 'BidWitMeApp'");
    expect(routes).toContain("SHELL_UA_MARKER = 'BidWitMeApp'");
  });

  // The seventh pin from the build lane — the native patch (delivered alongside,
  // applied on the Mac) carrying the marker + scheme — was DROPPED at ship time
  // (review F2): the patch lives OUTSIDE the repo by design, so a repo test reading
  // it would fail in any clean tree/CI. The native patch is instead guarded by its
  // own apply-check against the pristine SPM base files (native-patch/APPLY.md).
});
