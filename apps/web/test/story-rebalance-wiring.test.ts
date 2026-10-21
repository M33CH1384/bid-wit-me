/**
 * Story rebalance wiring pins (2026-10-21): the storytelling moved into the
 * match, and Table's story session is where it fires. Source pins in the
 * house style (story-rematch-wiring.test.ts) for the parts happy-dom cannot
 * execute end-to-end:
 *  - Table appends Dee's made-nil callback at the final hand ONLY when the
 *    event is in the session's recorded memory (it really happened);
 *  - storyScene detects the midgame milestone (the signature beat's moment)
 *    and the deeNilMade memory event from real hand records.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
const scene = readFileSync(new URL('../src/story/storyScene.ts', import.meta.url), 'utf8');

describe('story rebalance wiring', () => {
  it("Table appends Dee's nil callback at finalHand only from recorded memory", () => {
    expect(table).toContain("if (S.memory.has('deeNilMade')) beats = [...beats, ...callbackFor(stop, 'deeNilMade')];");
  });
  it('storyScene detects midgame at two completed hands and Dee-nil events from hand records', () => {
    expect(scene).toContain("if (next.historyLen === 2) out.push({ milestone: 'midgame', ahead: null });");
    expect(scene).toContain("if (lh.deeNilMade) out.push('deeNilMade');");
    expect(scene).toContain('deeNilMade: last.sides[0]?.nils.some((n) => n.seat === 2 && n.made) ?? false,');
  });
});
