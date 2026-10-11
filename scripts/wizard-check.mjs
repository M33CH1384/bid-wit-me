/**
 * Wizard + More options overflow audit on narrow phones (no WebGL needed). For each width it walks splash → play vs bots
 * / online → every mode → the essentials step, and opens More options (house rules expanded), checking that no
 * segmented control, setup row or control overflows its container horizontally or leaves the screen.
 * Usage: node scripts/wizard-check.mjs [web=http://localhost:4173] [out=screenshots/layout-wizard]   (STRICT=0 to only report)
 * Also imported by scripts/layout-check.mjs (runs first there).
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const WIZARD_WIDTHS = [[320, 640], [375, 667], [390, 844], [414, 896]];

/** in-page: every control inside its row / container and on screen */
export const overflowProbe = () => {
  const out = [];
  const vw = document.documentElement.clientWidth;
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const name = (e) => (e.getAttribute('data-testid') || e.getAttribute('aria-label') || e.className || e.tagName).toString().slice(0, 40) + (e.textContent ? ` "${e.textContent.trim().slice(0, 24)}"` : '');
  const rows = [...document.querySelectorAll('.ess-row, .row, .sf-row, .seg, .row-control, .join-row, .mode-card, .big-choice')].filter(vis);
  for (const c of rows) {
    const cr = c.getBoundingClientRect();
    if (cr.left < -1 || cr.right > vw + 1) out.push(`${name(c)} leaves the screen [${Math.round(cr.left)}..${Math.round(cr.right)} of ${vw}]`);
    if (c.scrollWidth > c.clientWidth + 2 && getComputedStyle(c).overflowX !== 'auto' && getComputedStyle(c).overflowX !== 'scroll') out.push(`${name(c)} content overflows (${c.scrollWidth} > ${c.clientWidth})`);
    for (const k of c.children) {
      if (!vis(k)) continue;
      const kr = k.getBoundingClientRect();
      if (kr.right > cr.right + 1.5 || kr.left < cr.left - 1.5) out.push(`${name(k)} sticks out of ${name(c)} [${Math.round(kr.left)}..${Math.round(kr.right)} vs ${Math.round(cr.left)}..${Math.round(cr.right)}]`);
    }
  }
  return [...new Set(out)];
};

export async function wizardAudit(browser, web, out, log = console.log) {
  mkdirSync(out, { recursive: true });
  const problems = [];
  for (const [w, h] of WIZARD_WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    await p.addInitScript(() => { try { localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); } catch { /* */ } });
    await p.goto(web);
    const check = async (label) => {
      await p.waitForTimeout(450);
      const probs = await p.evaluate(overflowProbe);
      await p.screenshot({ path: `${out}/${w}-${label}.png` });
      if (probs.length) { problems.push(...probs.map((x) => `${w}px ${label}: ${x}`)); log(`✗ ${w}px ${label}: ${probs.join('; ')}`); } else log(`✓ ${w}px ${label}`);
    };
    await p.getByTestId('play-bots').waitFor({ timeout: 30000 });
    await check('home');
    for (const path of ['bots', 'online']) {
      await p.getByTestId(`play-${path}`).click();
      await check(`${path}-mode`);
      const modes = await p.locator('[data-testid^="mode-"]').evaluateAll((els) => els.map((e) => e.dataset.testid));
      for (const m of modes) {
        await p.getByTestId(m).click();
        await check(`${path}-${m}`);
        await p.getByTestId('wiz-back').click();
      }
      await p.getByTestId('wiz-back').click();
    }
    // More options with the house rules open
    await p.getByTestId('play-bots').click();
    await p.locator('[data-testid^="mode-"]').first().click();
    await p.getByTestId('more').click();
    await p.getByTestId('more-options').waitFor();
    const house = p.getByRole('button', { name: /House rules/ });
    if (await house.count()) await house.click();
    await check('more-options');
    await p.getByTestId('more-options').evaluate((e) => { const s = e.querySelector('.sheet-body') ?? e; s.scrollTop = s.scrollHeight; });
    await check('more-options-end');
    await ctx.close();
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const web = process.argv[2] ?? 'http://localhost:4173';
  const out = process.argv[3] ?? 'screenshots/layout-wizard';
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const problems = await wizardAudit(browser, web, out);
  await browser.close();
  console.log(problems.length ? `${problems.length} wizard overflow problem(s)` : 'wizard: no overflow');
  if (problems.length && process.env.STRICT !== '0') process.exit(1);
}
