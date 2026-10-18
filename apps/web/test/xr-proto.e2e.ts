/** XR prototype desktop fallback (headsets honestly untested): page loads, the XR status
 *  panel reports its boot checks (or the no-XR fallback), click plays a card gently/flat. */
import { webkit } from 'playwright-core';
type W = { __bwmXrCards?: Record<string, { x: number; y: number }>; __bwmXr?: { played: string }; __bwmXrStatus?: { phase: string; lines: string[] } };
(async () => {
  const b = await webkit.launch({ headless: true });
  try {
    const page = await b.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(30000);
    await page.goto(`${process.env.BWM_URL ?? 'http://127.0.0.1:5173'}/xr.html`);
    await page.waitForFunction(() => Object.keys((window as unknown as W).__bwmXrCards ?? {}).length >= 5, undefined, { timeout: 45000 });
    const status = await page.evaluate(() => (window as unknown as W).__bwmXrStatus);
    console.log('xr status:', status?.phase, '|', (status?.lines ?? []).join(' | '));
    if (!status || !['no-xr', 'unsupported', 'ready', 'checking'].includes(status.phase)) throw new Error(`unexpected xr status phase: ${status?.phase}`);
    const panel = await page.textContent('[data-testid="xr-status"]');
    if (!panel || !panel.includes('XR status log')) throw new Error('xr status panel missing');
    const cards = await page.evaluate(() => (window as unknown as W).__bwmXrCards!);
    const [id, pt] = Object.entries(cards)[3]!;
    console.log(`clicking ${id} at ${pt.x.toFixed(0)},${pt.y.toFixed(0)}`);
    await page.mouse.click(pt.x, pt.y);
    await page.waitForFunction(() => !!(window as unknown as W).__bwmXr?.played, undefined, { timeout: 15000 });
    const played = await page.evaluate(() => (window as unknown as W).__bwmXr);
    console.log('played:', played);
    await page.screenshot({ path: `${process.env.BWM_SHOTS ?? '/opt/cursor/artifacts'}/xr-proto-desktop.png` });
    console.log('xr-proto OK');
  } finally { await b.close(); }
})();
