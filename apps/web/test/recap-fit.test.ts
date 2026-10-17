import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('Hand Recap one-screen fit (390x844)', () => {
  it('does not waste top slack between the header and TOP SCORES', () => {
    // the old 56-58px body top padding cleared a fixed chat button; the header is in flow
    expect(css).not.toContain('.tt-body { padding: 56px 12px 22px; }');
    expect(css).not.toContain('.tt-body { padding: 58px 12px 20px; gap: 14px; }');
    expect(css).toContain('.tt-body { padding: 12px 12px 14px; gap: 10px; }');
  });

  it('tightens gaps/padding only — team rows and text sizes from #224/#230 are preserved', () => {
    expect(css).toContain('.tt-recap { gap: 16px; }');
    // #224: team cards keep their roomy phone padding, scores only in TOP SCORES (#230)
    expect(css).toContain('.tt-team { padding: 16px 14px 14px; }');
    expect(css).toContain('.tt-top-scores li b { font-size: 22px; font-weight: 800; }');
    expect(css).toContain('.tt-team-name b { font-size: 20px; }');
  });
});
