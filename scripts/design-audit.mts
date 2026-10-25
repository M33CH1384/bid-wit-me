/** Design-audit harness — whole-app layout coherence pass (owner 2026-10-24).
 * Renders the REAL app (vite preview build) in headless Chromium across the
 * size × theme matrix and asserts geometry: nothing content/action-bearing
 * clipped off-viewport without a scroll ancestor, no interactive overlaps,
 * text not covered (elementFromPoint sampling), tap targets ≥44px on touch
 * sizes, no horizontal overflow. Defects are computed from measured rects.
 * Usage: tsx scripts/design-audit.mts --base http://127.0.0.1:4173 --out <dir>
 *        --batch <name> [--surfaces a,b] [--sizes 390x844,...] [--themes classic,neon]
 *        [--proxy http://127.0.0.1:8899]   (needed in sandboxes whose Chromium
 *        blocks loopback via Local Network Access checks)
 * Chromium is launched fresh per invocation — run invocations SERIALLY
 * (flock) on memory-tight machines. Output: results-<batch>.json + a PNG per
 * defect combo.
 *
 * THE GATE (Stage 3 of the design-coherence program): this harness plus the
 * constants-parsed fit-pin suites in apps/web/test (layout-*-fit.test.ts,
 * seat-fit, story-room-lobby-fit, deck-tile-fit, plate-fit, …) are the
 * standing screen×size layout contract. The fit pins run in CI on every
 * push (pnpm test); this harness is the manual/deep sweep — run it before
 * calling any layout work done.
 * COVERAGE — what this harness CAN reach: entry/home, the full setup
 * wizard (door/branch/opponent/table/more/deck-browser/find-table/
 * create-table), the offline table (playing + bidding, seeded saves),
 * versus intro, settings sheet, social panel, profile route (guest),
 * story gate (locked view), rewards route (empty state).
 * What it CANNOT reach (audited by CSS geometry instead — see
 * ~/workspace/your_files/design-audit/AUDIT.md and out/css-audit.md):
 * live online rooms + the online lobby's seated states (needs the
 * production Worker; re-swept against prod after lobby changes),
 * signed-in profile/social states, story inner screens (allowlist-gated),
 * in-game sub-states (recap, score pad, victory) beyond the versus intro.
 * KNOWN MEASUREMENT ARTIFACTS (not defects): hand-fan card×card overlaps
 * (by design); rect pairs across a modal boundary (sheet vs the page
 * beneath it) except pairs sharing the fixed layer; elements inside
 * horizontal scrollers clipped by the scrollport. */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { makeRules, newGame } from '@spades/rules';
import { DEFAULT_SETTINGS } from '../apps/web/src/settings.ts';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) if (process.argv[i].startsWith('--')) args[process.argv[i].slice(2)] = process.argv[i + 1];
const BASE = args.base ?? 'http://127.0.0.1:4173';
const OUT = args.out ?? '.';
const BATCH = args.batch ?? 'batch';
const PROXY = args.proxy ?? process.env.BWM_AUDIT_PROXY ?? '';
mkdirSync(OUT, { recursive: true });

const ALL_SIZES = [
  [375, 667], [390, 844], [430, 932],
  [667, 375], [844, 390], [932, 430],
  [768, 1024], [1024, 768], [1180, 820],
  [1440, 900], [1920, 1080],
];
const SIZES = args.sizes ? args.sizes.split(',').map((s) => s.split('x').map(Number)) : ALL_SIZES;
const THEMES = args.themes ? args.themes.split(',') : ['classic', 'neon'];
const isTouch = ([w]) => w < 1440;

function gameSave(phase) {
  const dealt = newGame(makeRules('joker'), 'audit-seed', { dealer: 3 });
  const st = { ...dealt, phase, bids: phase === 'bidding' ? [null, null, null, null] : [3, 3, 3, 3], tricks: [], tricksWon: [0, 0, 0, 0], turn: 0, trick: { leader: 0, winner: null, plays: [] }, spadesBroken: true, revealed: [true, true, true, true] };
  return JSON.stringify({ v: 1, savedAt: Date.now(), seed: st.seed, settings: { ...DEFAULT_SETTINGS, speed: 'turbo', quality: 'high', botLevel: 'novice', venue: 'classic' }, state: st, chat: [], names: ['You', 'Big Mike', 'Omar', 'Sven'], teamNames: null });
}
const seedCommon = (theme) => (t) => {
  try {
    localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} }));
    localStorage.setItem('bwm.fx', JSON.stringify({ reduce: true, nuke: 'off' }));
    if (t === 'neon') localStorage.setItem('bwm.theme.v1', JSON.stringify({ theme: 'neon' }));
    else localStorage.removeItem('bwm.theme.v1');
  } catch { /* */ }
};

async function settle(page, ms = 650) { await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {}); await page.waitForTimeout(ms); }
async function dismissEntry(page) {
  const guest = page.getByTestId('entry-guest');
  if (await guest.count().catch(() => 0)) { await guest.click().catch(() => {}); await page.waitForTimeout(400); }
  const skip = page.getByTestId('first-prefs-skip');
  if (await skip.count().catch(() => 0)) { await skip.click().catch(() => {}); await page.waitForTimeout(300); }
}
async function gotoHome(page) { await page.goto(BASE + '/'); await settle(page); await dismissEntry(page); await settle(page, 350); }
async function toDoor(page) { await gotoHome(page); await page.getByTestId('play').first().click(); await settle(page, 450); }
async function toOpponentCut(page) { await toDoor(page); await page.getByTestId('door-cutthroat').click(); await settle(page, 450); }
async function toTableStepBots(page) { await toOpponentCut(page); await page.getByTestId('play-bots').click(); await settle(page, 550); }

const SURFACES = {
  entry: async (page) => { await page.goto(BASE + '/'); await settle(page, 1200); return (await page.getByTestId('entry-modal').count()) ? 'entry modal visible' : 'no entry modal served in this environment (home directly)'; },
  home: async (page) => { await gotoHome(page); return 'home / wizard home step'; },
  'wizard-door': async (page) => { await toDoor(page); return 'wizard door step (team vs cutthroat)'; },
  'wizard-branch': async (page) => { await toDoor(page); await page.getByTestId('door-team').click(); await settle(page, 450); return 'wizard branch step (jokers vs ace down)'; },
  'wizard-opponent': async (page) => { await toOpponentCut(page); return 'wizard opponent step (bots vs online)'; },
  'wizard-table': async (page) => { await toTableStepBots(page); return 'wizard table step vs bots (deck gallery, venue, DEAL ME IN bar)'; },
  'wizard-more': async (page) => { await toTableStepBots(page); await page.getByTestId('more').click(); await settle(page); return 'more-options sheet open'; },
  'deck-browser': async (page) => { await toTableStepBots(page); const cover = page.locator('[data-testid^="deck-"]').first(); await cover.click(); await settle(page); return (await page.getByTestId('deck-browser').count()) ? 'deck browser sheet open' : 'deck browser DID NOT open'; },
  'find-table': async (page) => { await toOpponentCut(page); await page.getByTestId('play-online').click(); await settle(page, 1600); return 'online table step: lobby view (Find a Table / Open Tables)'; },
  'create-table': async (page) => { await toOpponentCut(page); await page.getByTestId('play-online').click(); await settle(page, 1200); const c = page.getByTestId('create-open'); if (await c.count()) { await c.click(); await settle(page, 800); return 'create-table form (wizard create view)'; } return 'create view NOT reached (no create-open)'; },
  table: async (page) => { await seedTable(page, 'playing'); return 'offline table, playing phase (seeded save, resumed)'; },
  'table-bid': async (page) => { await seedTable(page, 'bidding'); return 'offline table, bidding phase (seeded save, resumed)'; },
  versus: async (page) => { await toTableStepBots(page); await page.getByTestId('start-bots').click(); await page.waitForTimeout(1300); return 'versus intro / table entry after DEAL ME IN'; },
  settings: async (page) => { await gotoHome(page); const gear = page.locator('button[aria-label="Settings"], [data-testid="settings-open"]').first(); await gear.click(); await settle(page); return 'settings sheet (gear clicked from home)'; },
  social: async (page) => { await gotoHome(page); await page.getByTestId('social-btn').first().click(); await settle(page); return (await page.getByTestId('social-panel').count()) ? 'social panel open' : 'social panel DID NOT open'; },
  profile: async (page) => { await page.goto(BASE + '/profile'); await settle(page, 1300); await dismissEntry(page); await settle(page, 400); return 'profile route as served in this environment'; },
  'story-gate': async (page) => { await page.goto(BASE + '/story'); await settle(page, 1300); await dismissEntry(page); await settle(page, 400); return 'story route as served in this environment (guest/locked expected without an allowlisted account)'; },
  rewards: async (page) => { await page.goto(BASE + '/rewards'); await settle(page, 1100); return 'rewards route (no fresh game state)'; },
};
async function seedTable(page, phase) {
  await page.addInitScript((raw) => { try { localStorage.setItem('bwm.game', raw); } catch { /* */ } }, gameSave(phase));
  await page.goto(BASE + '/'); await settle(page); await dismissEntry(page);
  const r = page.getByTestId('resume');
  if (await r.count().catch(() => 0)) await r.click().catch(() => {});
  await page.waitForFunction(() => document.querySelectorAll('.plate, [data-testid="hand"]').length > 0, undefined, { timeout: 20000 }).catch(() => {});
  await settle(page, 1000);
}

/* In-page geometry probe, kept as a string so tsx/esbuild name helpers can
 * never leak into the evaluated source. */
const PROBE_SRC = `(() => {
  const vw = innerWidth, vh = innerHeight;
  const vis = (el) => { const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const idOf = (el) => el.getAttribute('data-testid') || el.getAttribute('aria-label') || (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 42) || (el.className && el.className.toString ? el.className.toString().slice(0, 42) : '') || el.tagName;
  const inter = (el) => el.matches('button, a, input, select, textarea, [role="button"], [role="tab"], [role="switch"], [data-testid^="card-"]');
  const clipAnc = (el) => { let p = el.parentElement; while (p) { const s = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(s.overflowX + s.overflowY)) return 1; p = p.parentElement; } return 0; };
  const els = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    let directText = false; for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim().length > 0) { directText = true; break; }
    els.push({ tag: el.tagName, id: idOf(el), cls: (el.className && el.className.toString ? el.className.toString() : '').slice(0, 60), x: r.x, y: r.y, w: r.width, h: r.height, inter: inter(el), text: directText, fixed: getComputedStyle(el).position === 'fixed', clip: clipAnc(el), sw: el.scrollWidth, cw: el.clientWidth, primary: el.matches('.primary, .go, [data-primary]') });
  }
  const covered = [];
  const cand = els.filter((e) => e.text || e.inter);
  const byEl = new Map(); for (const el of document.querySelectorAll('body *')) { if (vis(el)) byEl.set(el, true); }
  const nodeList = [...document.querySelectorAll('body *')].filter((el) => vis(el) && ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0) || el.matches('button, a, input, select, textarea, [role="button"]')));
  for (const el of nodeList) {
    if (clipAnc(el)) continue; // inside a scroller: partially out of the scrollport is by design
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const pts = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
    let hits = 0;
    for (const [fx, fy] of pts) {
      const x = r.x + r.width * fx, y = r.y + r.height * fy;
      if (x < 0 || y < 0 || x > vw || y > vh) continue;
      const hit = document.elementFromPoint(x, y);
      if (hit && (hit === el || el.contains(hit) || hit.contains(el))) hits++;
    }
    const inViewPts = pts.filter(([fx, fy]) => { const x = r.x + r.width * fx, y = r.y + r.height * fy; return x >= 0 && y >= 0 && x <= vw && y <= vh; }).length;
    if (inViewPts >= 2 && hits === 0) covered.push(idOf(el));
  }
  return { vw, vh, docW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight, els, covered };
})()`;

function defectsFor({ vw, vh, docW, els, covered }, touch) {
  const out = [];
  if (docW > vw + 1) out.push({ sev: 'P0', kind: 'horizontal-overflow', detail: `document scrollWidth ${docW} > viewport ${vw} by ${docW - vw}px` });
  const R = (e) => ({ l: e.x, t: e.y, r: e.x + e.w, b: e.y + e.h });
  for (const e of els) {
    const r = R(e);
    const offR = r.r - vw, offB = r.b - vh, offL = -r.l, offT = -r.t;
    if ((offR > 2 || offB > 2 || offL > 2 || offT > 2) && !e.clip) {
      out.push({ sev: e.inter || e.text ? 'P0' : 'P1', kind: 'off-viewport-no-scroll-ancestor', el: e.id, cls: e.cls, detail: `rect ${Math.round(r.l)},${Math.round(r.t)} -> ${Math.round(r.r)},${Math.round(r.b)} vs ${vw}x${vh} (over R${Math.round(offR)} B${Math.round(offB)} L${Math.round(offL)} T${Math.round(offT)})` });
    }
    if (touch && e.inter && e.w > 0 && (e.w < 44 || e.h < 44)) out.push({ sev: 'P1', kind: 'tap-target', el: e.id, cls: e.cls, detail: `${Math.round(e.w)}x${Math.round(e.h)}px < 44px floor` });
    if (e.text && e.sw > e.cw + 2 && !/name|ellipsis/.test(e.cls)) out.push({ sev: 'P2', kind: 'text-overflow', el: e.id, cls: e.cls, detail: `scrollWidth ${e.sw} > clientWidth ${e.cw}` });
  }
  for (const id of covered) out.push({ sev: 'P0', kind: 'covered-text-or-control', el: id, detail: 'elementFromPoint at 5 sample points never hits this element or a descendant — something paints over it' });
  const inters = els.filter((e) => e.inter);
  for (let i = 0; i < inters.length; i++) for (let j = i + 1; j < inters.length; j++) {
    const a = R(inters[i]), b = R(inters[j]);
    const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l), oy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
    if (ox > 2 && oy > 2) {
      const contains = (a.l <= b.l && a.t <= b.t && a.r >= b.r && a.b >= b.b) || (b.l <= a.l && b.t <= a.t && b.r >= a.r && b.b >= a.b);
      if (!contains) out.push({ sev: 'P0', kind: 'interactive-overlap', el: `${inters[i].id} x ${inters[j].id}`, detail: `overlap ${Math.round(ox)}x${Math.round(oy)}px` });
    }
  }
  // collapse duplicate kinds on the same element
  const seen = new Set(), ded = [];
  for (const d of out) { const k = d.kind + '|' + (d.el ?? '') + '|' + d.detail; if (!seen.has(k)) { seen.add(k); ded.push(d); } }
  return ded;
}

const launchArgs = ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'];
if (PROXY) launchArgs.push('--proxy-server=' + PROXY, '--proxy-bypass-list=<-loopback>');
const browser = await chromium.launch({ executablePath: process.env.BWM_CHROME ?? '/opt/meta-chromium/chrome', args: launchArgs });
const results = [];
const only = args.surfaces ? args.surfaces.split(',') : Object.keys(SURFACES);
for (const theme of THEMES) for (const [w, h] of SIZES) for (const sid of only) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: w < 768, hasTouch: isTouch([w, h]) });
  const page = await ctx.newPage();
  page.setDefaultTimeout(12000);
  await page.addInitScript(seedCommon(theme));
  let reached = '', err = '';
  try { reached = await SURFACES[sid](page); } catch (e) { err = String(e).slice(0, 260); reached = 'DRIVER ERROR'; }
  let defs = [];
  try { const probe = await page.evaluate(PROBE_SRC); defs = defectsFor(probe, isTouch([w, h])); } catch (e) { err += ' probe: ' + String(e).slice(0, 160); }
  if (defs.some((d) => d.sev !== 'P2')) await page.screenshot({ path: `${OUT}/${sid}-${theme}-${w}x${h}.png` }).catch(() => {});
  results.push({ surface: sid, theme, size: `${w}x${h}`, reached, err, defects: defs });
  console.log(`${sid} ${theme} ${w}x${h}: ${defs.length} (${defs.filter((d) => d.sev === 'P0').length} P0) — ${reached}${err ? ' ERR ' + err : ''}`);
  await ctx.close();
}
await browser.close();
writeFileSync(`${OUT}/results-${BATCH}.json`, JSON.stringify(results, null, 1));
const tally = {};
for (const r of results) for (const d of r.defects) tally[d.sev] = (tally[d.sev] ?? 0) + 1;
console.log('TALLY', JSON.stringify(tally), 'combos:', results.length);
