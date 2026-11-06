/**
 * WHEELS CONFETTI TIMING — source pins (owner, 2026-11-05: the confetti
 * falls when the declaring side actually earns its contract, not when it
 * bids 10). Node environment so the sources can be read from disk, the
 * animfx-hotring-removed pattern. Behaviour pins live in landCue.test.ts
 * (wheelsEarned), photoreal-fit.test.ts (the trigger map) and
 * wheels-confetti-timing.test.ts (the bus).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
const rewards = readFileSync(new URL('../src/GameOverRewards.tsx', import.meta.url), 'utf8');

describe('the wheels emit sites in Table.tsx', () => {
  it('bid declaration still emits the wheels moment at the call', () => {
    expect(table).toContain("fx.emit('wheels', { sub:");
  });

  it('the earn beat emits wheelsRain exactly once, silent, off the earn predicate', () => {
    expect(table.match(/fx\.emit\('wheelsRain'/g) ?? []).toHaveLength(1);
    expect(table).toContain("fx.emit('wheelsRain', { silent: true })");
    expect(table).toContain('wheelsEarned(r, st.bids, p.tricksWon, st.tricksWon)');
  });

  it('the rain is gated like the car beats beside it: never into the results-covered table', () => {
    const at = table.indexOf("fx.emit('wheelsRain'");
    expect(at).toBeGreaterThan(0);
    expect(table.slice(Math.max(0, at - 500), at)).toContain("wheelsGate.phaseRef.current === 'gameOver'");
  });

  it('the results surface keeps its own separate victory confetti', () => {
    expect(rewards).toContain('VictoryConfetti');
  });
});
