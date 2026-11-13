/**
 * Renege calls (owner, 2026-11-12) — the web layer's part of the house rule:
 * the setting reaches the rules, the hand gates on what the engine ACCEPTS
 * (not on what is honest), a ruling's books show on the plates at once, and an
 * online view's rulings rotate into the local frame.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type Card, type GameState, applyAction, bidOrder, buildDeck, makeRules, newGame, viewFor } from '@spades/rules';
import { DEFAULT_SETTINGS, rulesSummary, settingsToRules } from '../src/settings';
import { landedTook, shownTook, withPenaltyBooks } from '../src/tookDisplay';
import { rotateView } from '../src/online/rotate';

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

const rules = { ...makeRules('joker'), firstHandBidsItself: false, shotOut: false, renege: true };

/** Seat 0 leads the A♥, seat 1 cuts with the 3♠ holding hearts; seats 2 and 3 follow. Seat 1 wins book 1. */
function reneged(): GameState {
  const partial: Card[][] = [['AH', 'KH'], ['5H', '3S'], ['6H'], ['8H']];
  const used = new Set(partial.flat());
  const rest = buildDeck(rules).filter((c) => !used.has(c));
  const hands = partial.map((h) => { const out = [...h]; while (out.length < 13) out.push(rest.shift()!); return out; });
  let st: GameState = { ...newGame(rules, 'renege-web'), dealer: 3, hands, turn: bidOrder(rules, 3)[0]!, trick: { leader: 0, plays: [], winner: null } };
  while (st.phase === 'bidding') st = applyAction(st, { type: 'bid', seat: st.turn!, bid: 3 });
  for (const card of ['AH', '3S', '6H', '8H'] as Card[]) st = applyAction(st, { type: 'play', seat: st.turn!, card });
  return st;
}

describe('the setting', () => {
  it('is off by default and reaches the rules only when switched on', () => {
    expect(settingsToRules(DEFAULT_SETTINGS).renege).toBeUndefined();
    expect(settingsToRules({ ...DEFAULT_SETTINGS, renege: true }).renege).toBe(true);
    expect(rulesSummary(settingsToRules(DEFAULT_SETTINGS))).not.toContain('Renege');
    expect(rulesSummary(settingsToRules({ ...DEFAULT_SETTINGS, renege: true }))).toContain('Renege calls on');
  });

  it('has a House rules toggle and a lobby toggle', () => {
    expect(src('MoreOptions.tsx')).toContain('<Toggle label="Renege calls" value={s.renege === true} onChange={(v) => set(\'renege\', v)} />');
    expect(src('online/Lobby.tsx')).toContain('data-testid="lobby-renege"');
  });
});

describe('the table', () => {
  it('lights the cards the engine accepts, and sends calls the right way in each mode', () => {
    const table = src('Table.tsx');
    expect(table).toContain('viewLegal: view.playable ?? view.legal, hand })');
    expect(table).toContain("if (online) online.renege!.call(target, trick); else apply({ type: 'callRenege', seat: HUMAN, target, trick });");
    expect(src('online/OnlineTable.tsx')).toContain("conn.send({ t: 'renegeCall', target: rot.R(target), trick })");
  });

  it('bots stay honest unless the driver opts an opposing bot in', () => {
    const game = src('useGame.ts');
    expect(game).toContain('sideOf(turn.seat, st.rules) !== sideOf(HUMAN, st.rules)');
    expect(game).toContain('chooseRenegeCall(viewFor(st, i), lvOf(i))');
  });

  it('a ruling moves the plates at once', () => {
    const st = applyAction(reneged(), { type: 'callRenege', seat: 0, target: 1, trick: 0 });
    expect(st.tricksWon).toEqual([1, 0, 0, 0]);
    const landed = landedTook(st.tricks, st.tricks.length, 4); // seat 1 physically won the book
    expect(landed).toEqual([0, 1, 0, 0]);
    expect(shownTook(landed, st.tricksWon)).toEqual([0, 0, 0, 0]); // the old display hid the moved book
    expect(shownTook(withPenaltyBooks(landed, st.tricks, st.tricksWon), st.tricksWon)).toEqual([1, 0, 0, 0]);
    // with no penalty in play it changes nothing
    const plain = reneged();
    expect(withPenaltyBooks([0, 0, 0, 0], plain.tricks, plain.tricksWon)).toEqual([0, 0, 0, 0]);
    expect(withPenaltyBooks(landedTook(plain.tricks, 1, 4), plain.tricks, plain.tricksWon)).toEqual(plain.tricksWon);
  });
});

describe('online: the view rotates into the local frame', () => {
  it('rulings and callable books follow the seats', () => {
    const st = applyAction(reneged(), { type: 'callRenege', seat: 0, target: 1, trick: 0 });
    // seen from real seat 3: caller (0) is local 1, the reneger (1) is local 2; side 0 is THEIR side (local 1)
    const { view } = rotateView(viewFor(st, 3));
    expect(view.renege!.calls[0]).toMatchObject({ by: 1, target: 2, correct: true, from: 0, to: 1, proof: { led: 'AH', played: '3S' } });
    // real seat 3 may still call real seat 2 (local 3) on book 1; real seat 0 led it
    expect(view.renege!.open).toEqual([{ trick: 0, targets: [3] }]);
    expect(view.playable).toEqual(viewFor(st, 3).playable);
  });
});
