/**
 * Release 8 accounts e2e (phone 390×844, headless Chrome): sign-in sheet → mock OAuth round trip → username picker
 * (reserved name refused, free name saved) → Save my progress → link a second login → add a passkey (Chrome virtual
 * authenticator) → sign out → sign back in with the passkey → delete account; then a brand-new passkey account;
 * privacy / terms / data-deletion pages; no CSP violations anywhere.
 * Needs: `vite preview` on :4173 (proxies /api → :8787) and a local Worker started with
 *   wrangler dev --port 8787 --var AUTH_MOCK:1 --var PUBLIC_ORIGIN:http://localhost:4173 --var RATE_LIMITS_OFF:1
 * Usage: node scripts/accounts-e2e.mjs [web=http://localhost:4173] [out=screenshots/release-8]
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const web = process.argv[2] ?? 'http://localhost:4173';
const out = process.argv[3] ?? 'screenshots/release-8';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const problems = [];
page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text())) problems.push(`CSP: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const tid = (t) => page.getByTestId(t);
const expectVisible = async (t, ms = 8000) => { await tid(t).first().waitFor({ state: 'visible', timeout: ms }); };
const rnd = Math.random().toString(36).slice(2, 7);
const name = `E2e${rnd}`;

// virtual passkey authenticator (Face ID / fingerprint stand-in)
const cdp = await ctx.newCDPSession(page);
await cdp.send('WebAuthn.enable');
await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });

await page.goto(web);
await page.evaluate(([who]) => {
  localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true }));
  localStorage.setItem('bwm.badges.v1', JSON.stringify({ v: 1, badges: [{ id: 'storm-chaser', earnedAt: 1760000000000 }] }));
  localStorage.setItem('bwm.teamName', 'Shot Callers');
  localStorage.setItem('bwm.mockAs', who);
}, [`u_${rnd}`]);
await page.reload();

// 1. guest: Sign in chip → sheet with providers, passkeys, keep playing as guest
await expectVisible('signin-btn');
await shot('01-splash-guest');
await tid('signin-btn').click();
await expectVisible('signin-sheet');
for (const t of ['signin-mock', 'signin-passkey', 'create-passkey', 'keep-guest']) await expectVisible(t);
await shot('02-signin-sheet');
await tid('keep-guest').click();
await tid('signin-sheet').waitFor({ state: 'detached' });
console.log('✓ sign-in sheet: providers, passkeys, keep playing as guest');

// 2. OAuth round trip (mock provider) → username picker on first sign-in
await tid('signin-btn').click();
await tid('signin-mock').click();
await expectVisible('username-sheet', 15000);
if (!(await tid('username-input').inputValue())) throw new Error('username picker should be prefilled with a suggestion');
await tid('username-input').fill('admin');
await page.waitForFunction(() => /reserved/i.test(document.querySelector('[data-testid=username-msg]')?.textContent ?? ''), null, { timeout: 5000 });
await tid('username-input').fill(name);
await page.waitForFunction(() => /available/i.test(document.querySelector('[data-testid=username-msg]')?.textContent ?? ''), null, { timeout: 5000 });
await shot('03-username-picker');
await tid('username-save').click();
await tid('username-sheet').waitFor({ state: 'detached' });
await page.waitForFunction((n) => document.querySelector('[data-testid=account-btn]')?.textContent?.includes(n), name, { timeout: 5000 });
console.log(`✓ mock OAuth sign-in, reserved name refused, username "${name}" saved`);

// 3. Account screen + Save my progress
await tid('account-btn').click();
await expectVisible('account-sheet');
await expectVisible('linked-mock');
await shot('04-account');
await tid('save-progress').click();
await expectVisible('progress-saved');
console.log('✓ account screen + Save my progress');

// 4. link a second login (comes back with the account screen open)
await page.evaluate((who) => localStorage.setItem('bwm.mockAs', who), `alt_${rnd}`);
await tid('link-mock').click();
await expectVisible('account-sheet', 15000);
if ((await tid('linked-mock').count()) !== 1 && (await page.locator('[data-testid=linked-logins] li').count()) < 2) throw new Error('second login not linked');
console.log('✓ linked a second login');

// 5. add a passkey
await tid('add-passkey').click();
await expectVisible('linked-passkey', 10000);
await shot('05-account-passkey');
const passkeyLinked = await page.locator('[data-testid=linked-logins] li').count();
if (passkeyLinked < 2) throw new Error('expected login + passkey');
console.log('✓ passkey added (virtual authenticator)');

// 6. sign out → sign in with the passkey → same account
await tid('sign-out').click();
await expectVisible('signin-btn');
await tid('signin-btn').click();
await tid('signin-passkey').click();
await page.waitForFunction((n) => document.querySelector('[data-testid=account-btn]')?.textContent?.includes(n), name, { timeout: 10000 });
console.log('✓ signed out, signed back in with the passkey');

// 7. delete account (type the username to confirm)
await tid('account-btn').click();
await tid('delete-account').click();
await expectVisible('delete-sheet');
if (await tid('delete-confirm').isEnabled()) throw new Error('delete must need confirmation');
await tid('delete-confirm-input').fill(name);
await shot('06-delete-confirm');
await tid('delete-confirm').click();
await expectVisible('signin-btn');
const me = await page.evaluate(async () => (await (await fetch('/api/auth/me')).json()).user);
if (me) throw new Error('still signed in after delete');
// the old passkey no longer signs anyone in
await tid('signin-btn').click();
await tid('signin-passkey').click();
await page.waitForFunction(() => document.querySelector('[data-testid=signin-sheet] .err')?.textContent, null, { timeout: 10000 });
await tid('keep-guest').click();
console.log('✓ account deleted; its passkey no longer works');

// 8. brand-new account with a passkey (username first)
const pk = `Pk${rnd}`;
await tid('signin-btn').click();
await tid('create-passkey').click();
await expectVisible('username-sheet');
await tid('username-input').fill(pk);
await page.waitForFunction(() => /available/i.test(document.querySelector('[data-testid=username-msg]')?.textContent ?? ''), null, { timeout: 5000 });
await tid('username-save').click();
await page.waitForFunction((n) => document.querySelector('[data-testid=account-btn]')?.textContent?.includes(n), pk, { timeout: 10000 });
await shot('07-passkey-account');
await tid('account-btn').click();
await tid('delete-account').click();
await tid('delete-confirm-input').fill(pk);
await tid('delete-confirm').click();
await expectVisible('signin-btn');
console.log('✓ new account with a passkey, then deleted');

// 9. error path: a callback without the browser's state cookie comes back as a friendly error
await page.goto(`${web}/api/auth/mock/callback?code=x&state=forged`);
await expectVisible('acct-toast');
if (!/took too long|another browser/i.test(await tid('acct-toast').textContent())) throw new Error('state error message');
if (page.url().includes('signin=')) throw new Error('URL should be cleaned');
console.log('✓ forged callback → friendly error, URL cleaned');

// 10. public pages
for (const [p, h] of [['privacy', 'Privacy Policy'], ['terms', 'Terms of Service'], ['data-deletion', 'Delete your data']]) {
  await page.goto(`${web}/${p}`);
  const t = await page.locator('h1').textContent();
  if (t !== h) throw new Error(`/${p}: h1 "${t}"`);
  await shot(`08-${p}`);
}
await page.goto(`${web}/data-deletion?code=nope`);
await page.waitForFunction(() => /No deletion request/.test(document.getElementById('status')?.textContent ?? ''), null, { timeout: 5000 });
console.log('✓ /privacy, /terms, /data-deletion (+ status lookup)');

await browser.close();
if (problems.length) { console.log(problems.join('\n')); process.exit(1); }
console.log('no CSP violations or page errors\nACCOUNTS E2E PASS');
