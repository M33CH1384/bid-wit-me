/**
 * Live smoke for accounts on the deployed site (no test hooks): passkey account create → sign out → passkey sign in →
 * delete; Online lobby opens with no CSP errors. Usage: node scripts/accounts-live-smoke.mjs [web=https://bid-wit-me.pages.dev]
 */
import { chromium } from 'playwright-core';

const web = process.argv[2] ?? 'https://bid-wit-me.pages.dev';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const problems = [];
page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text())) problems.push(`CSP: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
const cdp = await ctx.newCDPSession(page);
await cdp.send('WebAuthn.enable');
await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
const tid = (t) => page.getByTestId(t);
const name = `Live${Math.random().toString(36).slice(2, 7)}`;

await page.goto(web);
await page.evaluate(() => localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })));
await page.reload();
await tid('signin-btn').waitFor({ timeout: 15000 });
await tid('signin-btn').click();
if (await tid('signin-google').count()) throw new Error('google shown without secrets');
await tid('create-passkey').click();
await tid('username-input').fill(name);
await page.waitForFunction(() => /available/i.test(document.querySelector('[data-testid=username-msg]')?.textContent ?? ''), null, { timeout: 8000 });
await tid('username-save').click();
await page.waitForFunction((n) => document.querySelector('[data-testid=account-btn]')?.textContent?.includes(n), name, { timeout: 15000 });
const cookies = await ctx.cookies(web);
const sid = cookies.find((c) => c.name === '__Host-bwm_sid');
if (!sid || !sid.httpOnly || !sid.secure || sid.sameSite !== 'Lax') throw new Error(`session cookie flags: ${JSON.stringify(sid)}`);
if (await page.evaluate(() => document.cookie.includes('bwm_sid'))) throw new Error('session cookie readable by scripts');
console.log(`✓ live: passkey account "${name}" created; session cookie HttpOnly + Secure + SameSite=Lax, first-party`);
await tid('account-btn').click();
await tid('sign-out').click();
await tid('signin-btn').waitFor();
await tid('signin-btn').click();
await tid('signin-passkey').click();
await page.waitForFunction((n) => document.querySelector('[data-testid=account-btn]')?.textContent?.includes(n), name, { timeout: 15000 });
console.log('✓ live: signed out and back in with the passkey');
await page.screenshot({ path: 'screenshots/release-8/live-signed-in.png' });
await tid('account-btn').click();
await tid('delete-account').click();
await tid('delete-confirm-input').fill(name);
await tid('delete-confirm').click();
await tid('signin-btn').waitFor();
if ((await page.evaluate(async () => (await (await fetch('/api/auth/me')).json()).user))) throw new Error('still signed in');
console.log('✓ live: account deleted');
await page.goto(`${web}/online`);
await page.waitForTimeout(4000);
await browser.close();
if (problems.length) { console.log(problems.join('\n')); process.exit(1); }
console.log('no CSP violations or page errors\nLIVE ACCOUNTS SMOKE PASS');
