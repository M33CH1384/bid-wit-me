/**
 * TOOK display timing (owner 2026-10-22): "The took number should not
 * increase until the cards are stacked next to that player and should have
 * an animation in the plate."
 *
 * Game state stays authoritative: tricksWon increments at trick resolution.
 * The PLATE, though, shows shownTook — the tally of tricks whose gather
 * flight to the winner's pile has finished (landedTook over the first
 * `landed` piled tricks) — so the number lags the state by exactly the
 * flight, then ticks once per book, in trick order, as each stack settles.
 * A hand that arrives whole (mount / refresh / resume) starts fully landed:
 * the true count shows at once with nothing pending and no pop.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOOK_GATHER_MS, landedTook, shownTook } from '../src/tookDisplay';

const tableSrc = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
const sceneSrc = readFileSync(new URL('../src/three/Scene.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

const tricks = (...winners: (number | null)[]) => winners.map((winner) => ({ winner }));

describe('landedTook — the plate lags the state until the cards land', () => {
  const hand = tricks(2, 0, 2, 1); // true tally once all resolve: [1, 1, 2, 0]

  it('shows nothing while every won trick is still on the felt or in flight', () => {
    expect(landedTook(hand, 0, 4)).toEqual([0, 0, 0, 0]);
  });

  it('ticks exactly once per book, in trick order, as each flight lands', () => {
    expect(landedTook(hand, 1, 4)).toEqual([0, 0, 1, 0]);
    expect(landedTook(hand, 2, 4)).toEqual([1, 0, 1, 0]);
    expect(landedTook(hand, 3, 4)).toEqual([1, 0, 2, 0]);
    expect(landedTook(hand, 4, 4)).toEqual([1, 1, 2, 0]);
  });

  it('clamps the landed count to the tricks that exist', () => {
    expect(landedTook(hand, 99, 4)).toEqual([1, 1, 2, 0]);
    expect(landedTook(hand, -1, 4)).toEqual([0, 0, 0, 0]);
  });

  it('skips unresolved tricks and works for a 3-player cutthroat hand', () => {
    expect(landedTook(tricks(0, null, 2, 0), 4, 3)).toEqual([2, 0, 1]);
    expect(landedTook(tricks(0, null, 2, 0), 2, 3)).toEqual([1, 0, 0]);
  });
});

describe('shownTook — landed tally, never ahead of the truth', () => {
  it('passes the landed tally through while it trails the truth', () => {
    expect(shownTook([1, 0, 2, 0], [1, 1, 2, 0])).toEqual([1, 0, 2, 0]);
  });

  it('caps at the true tally (a held pre-Run snapshot cannot be outrun)', () => {
    expect(shownTook([1, 1, 2, 0], [0, 0, 1, 0])).toEqual([0, 0, 1, 0]);
  });

  it('resume: a fully landed hand renders the true count with nothing pending', () => {
    const hand = tricks(2, 0, 2, 1, 3, 3);
    const truth = [1, 0, 2, 2];
    // landed = every piled trick, the state Table initializes on mount/resume
    expect(shownTook(landedTook(hand, hand.length, 4), truth)).toEqual(truth);
  });
});

describe('the landing the count keys on', () => {
  it('BOOK_GATHER_MS matches the gather flight Scene flies to the pile', () => {
    expect(sceneSrc).toContain("duration: 0.55, arc: 0.15, motion: 'gather'");
    expect(BOOK_GATHER_MS).toBe(550);
  });

  it('Table initializes landed books to the piled tricks (no replay on resume)', () => {
    expect(tableSrc).toContain('useState(() => piles.length)');
    expect(tableSrc).toContain('landSync');
  });

  it('every plate TOOK renders the shown tally, never the raw state tally', () => {
    expect(tableSrc).toContain('plateTookText(tookShown[seat] ?? 0, st.phase)'); // canvas facts
    expect(tableSrc).toContain('const took = tookShown[seat] ?? 0;'); // renderSeat
    expect(tableSrc).toContain('plateTookText(tookShown[HUMAN] ?? 0, st.phase)'); // your plate
    expect(tableSrc).not.toContain('plateTookText(plates.books');
    expect(tableSrc).toContain('${tookShown.join(\'.\')}'); // plate sync key ticks too
  });

  it('the pop fires from the shown-tally rise', () => {
    expect(tableSrc).toContain('popPlateTook(screen, s)');
  });
});

describe('took-pop CSS — in the plate, never on the anchor transform', () => {
  it('pops the plate body and flashes the TOOK chip for ~300 ms', () => {
    expect(css).toContain('@keyframes took-pop');
    expect(css).toContain('.plate.took-pop .plate-body { animation: took-pop .3s ease-out; }');
    expect(css).toContain('.plate.took-pop .chip.took { animation: took-chip .3s ease-out; }');
  });

  it('never animates .plate itself (its transform is the seat anchor centring)', () => {
    expect(css).not.toMatch(/\.plate\.took-pop\s*\{/);
  });

  it('the TOOK chips carry the took class the flash targets', () => {
    expect(tableSrc).toContain('className="chip took" data-testid={`books-${seat}`}');
    expect(tableSrc).toContain('className="chip took" data-testid="books-0"');
  });
});
