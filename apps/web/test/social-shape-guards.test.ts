/**
 * Payload-shape guards (crash hardening, 2026-11-06). The social fetch
 * layer casts 200 responses with TypeScript only; a present-but-wrong-
 * typed collection used to be stored verbatim and throw during render
 * — in the ticker's case on the menu with the panel never opened, in
 * Central's case inside the headline/rivalry engines, in the boards'
 * case on a bare `rows.length`. These pins keep the door guards in
 * place; LayerGuard (layer-guard.test.ts) is the second line.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

describe('social payload shape guards', () => {
  it('the ticker validates every polled collection before storing it', () => {
    const t = read('social/LeagueTicker.tsx');
    expect(t).toContain('function arrOrNull');
    expect(t).toContain('function saneResults');
    expect(t).toContain('arrOrNull<TickerTopRow>(j.rows)');
    expect(t).toContain('saneResults(j.results)');
    expect(t).toContain('arrOrNull<LiveHighlight>(j.highlights)');
    // wrong shapes keep the last good lines: setters stay conditional
    expect(t).not.toContain('setResults((j.results ?? [])');
  });

  it('the boards never store an unchecked collection', () => {
    const c = read('social/Compete.tsx');
    expect(c).toContain('Array.isArray(j.rows) ? j.rows : []');
    expect(c).toContain('Array.isArray(j.rows) ? (j as { week: string');
    expect(c).toContain('Array.isArray(j.tournaments) ? j.tournaments : []');
    const w = read('social/Wager.tsx');
    expect(w).toContain('Array.isArray(j.challenges) ? j.challenges : []');
  });

  it('Central assembles headlines from validated arrays only', () => {
    const c = read('social/Central.tsx');
    expect(c).toContain('function arr<T>(v: unknown): T[]');
    expect(c).toContain('arr<RecentResult>(resultsQ.data?.results)');
    expect(c).toContain('arr<H2hRow>(myProfileQ.data?.h2h)');
    expect(c).toContain('arr<PowerRowLike>(powerQ.data?.rows)');
    expect(c).toContain('arr<LiveHighlight>(highlightsQ.data?.highlights)');
  });

  it('MatchView routes a wrong-shaped 200 to its unavailable state', () => {
    const c = read('social/Central.tsx');
    expect(c).toContain('!Array.isArray(game.winners) || !Array.isArray(players) || !Array.isArray(timeline)');
  });
});
