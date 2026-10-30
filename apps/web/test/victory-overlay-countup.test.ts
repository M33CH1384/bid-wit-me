/**
 * Victory overlay count-up — source pins (owner, 2026-10-30: "Extend it
 * there to"). The in-table victory overlay's final tallies run the SAME
 * count-up performance as the rewards recap — RollNum + tallyTone from
 * GameOverRewards, the one implementation — in BOTH overlay variants
 * (the online room screen and the offline/story modal), and both box
 * scores opt into the Final-row roll. The online variant cannot be
 * driven in the local rig (no room), so its wiring is pinned here; it
 * renders the identical components the behavioral suite drives
 * (count-up-perf.test.ts covers BoxScore + tallyTone behavior).
 *
 * Node environment on purpose: happy-dom's URL class is rejected by
 * node:fs, so source-reading suites stay out of the DOM environment.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
const onlineStart = src.indexOf('{showResults && online?.victory');
const offlineStart = src.indexOf('{showResults && st.result && !online?.victory', onlineStart);
const online = src.slice(onlineStart, offlineStart);
const offline = src.slice(offlineStart, src.indexOf('<AnimFxLayer', offlineStart));

describe('the victory overlay wiring in Table.tsx', () => {
  it('finds both overlay variants', () => {
    expect(onlineStart).toBeGreaterThan(-1);
    expect(offlineStart).toBeGreaterThan(onlineStart);
    expect(online.length).toBeGreaterThan(500);
    expect(offline.length).toBeGreaterThan(500);
  });

  it('both placements lists roll their tallies with the shared tone rules', () => {
    for (const block of [online, offline]) {
      expect(block).toContain('<RollNum');
      expect(block).toContain('tallyTone(');
      expect(block).toContain('duration={1150}');
      expect(block).toContain('delay={200 + i * 120}');
      expect(block).toContain('step={50}');
    }
  });

  it('both box scores opt into the Final-row roll with the overlay reduce signal', () => {
    expect(online).toContain('winners={res.winners} roll reduced={reduceFx}');
    expect(offline).toContain('winners={st.result.winners} roll reduced={reduceFx}');
  });

  it('the overlay imports the one implementation — no second copy', () => {
    expect(src).toContain("RollNum, tallyTone, type RewardsProfile } from './GameOverRewards'");
    expect(src).not.toContain('useRollValue');
  });
});
