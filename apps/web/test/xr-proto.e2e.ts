/** XR prototype desktop fallback (headsets honestly untested): page loads, click plays a card with max slam. */
import { webkit } from 'playwright-core';
type W = { __bwmXrCards?: Record<string, { x: number; y: number }>; __bwmXr?: { played: string } };
(async () => {
  const b = await webkit.launch({ headless: true });
  try {
    const page = await b.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(30000);
    await page.goto(`${process.env.BWM_URL ?? 'http://127.0.0.1:5173'}/xr.html`);
    await page.waitForFunction(() => Object.keys((window as unknown as W).__bwmXrCards ?? {}).length >= 5, undefined, { timeout: 45000 });
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
