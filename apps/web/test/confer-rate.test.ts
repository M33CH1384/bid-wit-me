/**
 * @vitest-environment happy-dom
 *
 * Opponent conferral (§5.4) — effective-rate pins over simulated bid
 * phases, replaying the production call pattern (useGame:
 * offlineTalk.consultBidDelay(seat, st) at every bot bid turn) with the
 * real ConsultDriver, real engine, real rosters/levels. Math.random is
 * replaced by a seeded PRNG, so every count below is deterministic —
 * the bands assert the SPEC's geometry, not luck:
 *
 *  - the 0.55 roll is the only probability gate left standing: of the
 *    opponent turns that pass the structural skips (first bid of the
 *    hand; the one bid immediately before the human's own, by the real
 *    bid order), ~55% confer;
 *  - the two opponents CAN confer in the same hand (their turns are
 *    adjacent under bidOrder's team-back-to-back order — the old
 *    never-consecutive check made that impossible);
 *  - the human-deals rotation confers (the old seat-arithmetic proxy
 *    for "human bids next" blacked it out entirely);
 *  - the partner-deals rotation stays silent by design: one opponent
 *    opens (exempt) and the other bids immediately before the human;
 *  - every fire presents: a chat line synchronously, and — regular
 *    tables — the claim at the speaker's plate via deps.callout.
 */
import { describe, expect, it, vi } from 'vitest';
import { applyAction, makeRules, newGame, nextBidder, pendingTurn, viewFor, type GameState } from '@spades/rules';
import { botSkillFor, chooseBotAction, pickBotNames, platePersona } from '@spades/bots';

vi.mock('../src/talkPrefs', () => ({
  talkPrefs: { get: () => ({ botTalk: true, hideBotTalk: false, voices: true, voiceVolume: 0.6, aiVoices: true }) },
  spokenClipDurationMs: vi.fn(async () => 1000),
  speakConsult: vi.fn(),
  consultClipDurationMs: vi.fn(async () => 1800),
}));
vi.mock('../src/decks', () => ({ getActiveDeck: () => 'classic' }));

const { ConsultDriver } = await import('../src/consultDriver');
const { offlineTalk } = await import('../src/offlineTalk');

/** mulberry32 — deterministic stand-in for Math.random. */
function seededRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RULES = makeRules('joker', { firstHandBidsItself: false });
const HANDS = 240;

describe('opponent conferral — effective rate over simulated bid phases', () => {
  it('fires at the specced rate, in the rotations the spec intends', async () => {
    const rnd = vi.spyOn(Math, 'random').mockImplementation(seededRandom(20261023));
    try {
      let eligibleTurns = 0;
      let fires = 0;
      let pushes = 0;
      let callouts = 0;
      let handsWithConfer = 0;
      let doubleHands = 0;
      const conferHandsByDealer = [0, 0, 0, 0];
      for (let h = 0; h < HANDS; h++) {
        const dealer = h % 4;
        const seed = `rate-${h}`;
        const names = ['You', ...pickBotNames(3, ['You'], seed, platePersona)];
        const levelFor = (seat: number) => botSkillFor('mixed', seed, seat, names[seat] ?? '');
        offlineTalk.newGame();
        const driver = new ConsultDriver({
          story: false, names, partnerSeat: 2, humanSeat: 0, levelFor, k: () => 1,
          push: () => { pushes++; },
          callout: () => { callouts++; },
          seatPos: () => undefined, kingLeg2: () => false,
          humanHinted: () => false, humanNilAnnounced: () => false,
        });
        driver.attach();
        let st: GameState = newGame(RULES, seed, { dealer });
        let handFires = 0;
        let guard = 0;
        while (st.phase === 'bidding' && guard++ < 12) {
          const turn = pendingTurn(st);
          if (!turn || turn.kind !== 'bid') break;
          const seat = turn.seat;
          if (seat !== 0) {
            const isOpponent = seat !== 2;
            // structural eligibility, from the engine's own bid order:
            // not the hand's first bid, and not the bid immediately
            // before the human's own
            const bidsPlaced = st.bids.filter((b) => b !== null).length;
            const eligible = isOpponent && bidsPlaced > 0
              && !(st.bids[0] == null && nextBidder(st, seat) === 0);
            const extra = offlineTalk.consultBidDelay(seat, st);
            if (isOpponent) {
              if (eligible) eligibleTurns++;
              if (extra > 0) { fires++; handFires++; }
              // a structurally ineligible turn must never fire
              if (!eligible) expect(extra).toBe(0);
              // the bid itself is never delayed past the specced cap
              expect(extra).toBeLessThanOrEqual(900);
            }
          }
          const a = chooseBotAction(viewFor(st, seat), seat === 0 ? 'pro' : levelFor(seat));
          if (!a) break;
          st = applyAction(st, a);
        }
        if (handFires > 0) { handsWithConfer++; conferHandsByDealer[dealer]++; }
        if (handFires >= 2) doubleHands++;
        driver.dispose();
      }
      // the structural geometry is exact: 5 eligible opponent turns per
      // 4-hand dealer cycle (1 + 2 + 0 + 2), 60 cycles in 240 hands
      expect(eligibleTurns).toBe(300);
      // the 0.55 roll, honestly reached: ~55% of eligible turns confer
      expect(fires / eligibleTurns).toBeGreaterThan(0.45);
      expect(fires / eligibleTurns).toBeLessThan(0.65);
      // presence at the table: most hands hear the opponents confer
      expect(handsWithConfer / HANDS).toBeGreaterThan(0.45);
      // the pair can actually confer with each other in one hand
      expect(doubleHands).toBeGreaterThanOrEqual(8);
      // the human-deals rotation is no longer blacked out
      expect(conferHandsByDealer[0]!).toBeGreaterThanOrEqual(15);
      // the partner-deals rotation stays silent BY DESIGN (opener
      // exempt; the other opponent bids immediately before the human)
      expect(conferHandsByDealer[2]!).toBe(0);
      // presentation: every fire writes a chat line synchronously, and
      // the claim reaches the speaker's plate for the synchronous
      // (Form A) share of fires
      expect(pushes).toBeGreaterThanOrEqual(fires);
      expect(callouts).toBeGreaterThanOrEqual(Math.floor(fires * 0.5));
    } finally {
      rnd.mockRestore();
    }
    // let any Form B claim timers drain before the file moves on
    await new Promise((r) => setTimeout(r, 800));
  }, 300_000);
});
