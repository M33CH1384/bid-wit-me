/**
 * Option C — the ending showcase beat (owner, 2026-11-05): the wiring
 * pins that live in source text rather than the DOM — Table's gate and
 * the carried trick-review door, plus the showcase stage's CSS. The
 * behavioural pins (what renders, when it advances) live in
 * ending-showcase.test.ts; this node-environment file follows the
 * recap-present.test.ts split.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const tableSrc = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('Table wiring for the ending beat', () => {
  it('the hold is the ending beat now: shotOut/third-set only, ack renamed, results wait on it', () => {
    expect(tableSrc).toContain("const endingBeat = st.phase === 'gameOver'");
    expect(tableSrc).toContain("(st.result?.endReason === 'shotOut' || st.result?.endReason === 'third-set') && !endingBeatDone");
    expect(tableSrc).toContain('&& !endingBeat;');
    expect(tableSrc).toContain("if (st.phase === 'gameOver') setEndingBeatDone(true); else apply({ type: 'nextHand' })");
    expect(tableSrc).not.toContain('shotRecapAck');
    expect(tableSrc).not.toContain('shotOutRecap');
  });

  it('Review the tricks is carried onto BOTH results surfaces, recap door kept', () => {
    const mounts = tableSrc.split('<RecapTrickReview').length - 1;
    expect(mounts).toBe(3); // the recap header + the two results surfaces
    const vicAt = tableSrc.indexOf('data-testid="victory-scroll"');
    const goAt = tableSrc.indexOf('data-testid="gameover-scroll"');
    const doorVic = tableSrc.indexOf('<RecapTrickReview', vicAt);
    const doorGo = tableSrc.indexOf('<RecapTrickReview', goAt);
    expect(doorVic).toBeGreaterThan(vicAt);
    expect(doorGo).toBeGreaterThan(goAt);
    expect(doorVic).toBeLessThan(goAt); // victory surface precedes the offline modal in the file
  });

  it('story endings ride the same mount: the story stop id still reaches Intermission', () => {
    expect(tableSrc).toContain('storyStopId: story?.scene?.stop.id');
  });
});

describe('the showcase stage CSS', () => {
  it('is its own container — never the gridded .tt-body — centered by auto margins', () => {
    expect(css).toContain('.tt-showcase {');
    expect(css).toContain('.tt-showcase .tt-recap { margin: auto 0;');
  });
});
