/**
 * Live highlights (league data wave, item 6b): pure extraction from the
 * records the room already resolves + the bounded store + the read route.
 * Pins the honesty rules: human seats/sides only (bot moments are not
 * league news), Boston suppresses the same side's Wheels line, a regular
 * made nil is ticker-only (marquee = false) while a blind nil is marquee,
 * and stale events never leave the store's read.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { makeD1 } from './d1';
import { type HandRecord } from '@spades/rules';
import { handHighlights, recentHighlights, recordHighlight, trickHighlights, type HighlightEvent, type HighlightSeat } from '../src/stats/highlights';

const NOW = 1_800_000_000_000;
const SEATS: HighlightSeat[] = [
  { name: 'Dee', kind: 'user', side: 0 }, { name: 'Ray', kind: 'user', side: 1 },
  { name: 'Kim', kind: 'user', side: 0 }, { name: 'Bot', kind: 'bot', side: 1 },
];
const side = (side: number, tricks: number, o: Partial<{ contract: number; contractMade: boolean | null; nils: { seat: number; kind: 'nil' | 'blindNil'; made: boolean }[] }> = {}) => ({
  side, seats: [], contract: o.contract ?? 0, contractTricks: tricks, tricks, contractMade: o.contractMade ?? null,
  contractPoints: 0, nils: o.nils ?? [], bagsAdded: 0, bagPenaltyCount: 0, bagPenaltyPoints: 0, bookPoints: 0,
  points: 0, totalScore: 0, totalBags: 0, shot: false,
});
const rec = (sides: ReturnType<typeof side>[], bids: unknown[] = [4, 4, 4, 4]): HandRecord =>
  ({ handNo: 7, dealer: 0, bids: bids as HandRecord['bids'], tricksWon: [0, 0, 0, 0], sides: sides as HandRecord['sides'] });

describe('trickHighlights', () => {
  const nukeTrick = { plays: [{ seat: 0, card: 'BJ' as const }, { seat: 1, card: 'LJ' as const }, { seat: 2, card: 'QS' as const }, { seat: 3, card: 'JS' as const }] };
  it('a completed nuke trick names the Big Joker seat (marquee)', () => {
    const evs = trickHighlights({ tricks: [nukeTrick], seats: SEATS, code: 'TBL9', handNo: 7, at: NOW });
    expect(evs).toEqual([{
      id: 'TBL9:7:nuke:0', at: NOW, type: 'nuke', name: 'Dee',
      text: "☢ Dee's nuke blew in Hand 7", code: 'TBL9', hand: 7, marquee: true,
    }]);
  });
  it('a bot’s nuke is not league news; a quiet trick makes nothing', () => {
    const botNuke = { plays: [{ seat: 3, card: 'BJ' as const }, { seat: 0, card: 'LJ' as const }, { seat: 1, card: 'QS' as const }, { seat: 2, card: 'JS' as const }] };
    expect(trickHighlights({ tricks: [botNuke], seats: SEATS, code: 'TBL9', handNo: 7, at: NOW })).toEqual([]);
    const quiet = { plays: [{ seat: 0, card: 'AS' as const }, { seat: 1, card: 'KS' as const }] };
    expect(trickHighlights({ tricks: [quiet], seats: SEATS, code: 'TBL9', handNo: 7, at: NOW })).toEqual([]);
  });
});

describe('handHighlights', () => {
  it('Boston: the side that took every book headlines (and its Wheels line is not doubled)', () => {
    const evs = handHighlights({ rec: rec([side(0, 13, { contract: 9, contractMade: true }), side(1, 0)]), seats: SEATS, partnerships: true, code: 'TBL9', at: NOW });
    expect(evs.map((e) => [e.type, e.text, e.marquee])).toEqual([['boston', 'Dee + Kim just ran a Boston in Hand 7', true]]);
  });
  it('Wheels: a made 10+ contract (partnership) or 10+ tricks (cutthroat)', () => {
    const team = handHighlights({ rec: rec([side(0, 11, { contract: 10, contractMade: true }), side(1, 2)]), seats: SEATS, partnerships: true, code: 'TBL9', at: NOW });
    expect(team.map((e) => e.type)).toEqual(['wheels']);
    const cutSeats: HighlightSeat[] = [
      { name: 'Dee', kind: 'user', side: 0 }, { name: 'Ray', kind: 'user', side: 1 },
      { name: 'Kim', kind: 'user', side: 2 }, { name: 'Jo', kind: 'user', side: 3 },
    ];
    const cut = handHighlights({ rec: rec([side(0, 10), side(1, 3), side(2, 0), side(3, 0)]), seats: cutSeats, partnerships: false, code: 'TBL9', at: NOW });
    expect(cut.map((e) => [e.type, e.name])).toEqual([['wheels', 'Dee']]);
    const short = handHighlights({ rec: rec([side(0, 9, { contract: 10, contractMade: false }), side(1, 4)]), seats: SEATS, partnerships: true, code: 'TBL9', at: NOW });
    expect(short).toEqual([]);
  });
  it('made nils name the seat; blind nil is marquee, a regular nil is not; bot nils are skipped', () => {
    const evs = handHighlights({
      rec: rec([
        side(0, 8, { nils: [{ seat: 0, kind: 'nil', made: true }] }),
        side(1, 5, { nils: [{ seat: 1, kind: 'blindNil', made: true }, { seat: 3, kind: 'nil', made: true }] }),
      ]),
      seats: SEATS, partnerships: true, code: 'TBL9', at: NOW,
    });
    expect(evs.map((e) => [e.type, e.name, e.marquee])).toEqual([
      ['nil', 'Dee', false],
      ['blindNil', 'Ray', true],
    ]);
    expect(evs[1]!.text).toBe('Ray made a BLIND NIL in Hand 7');
  });
  it('an all-bot side makes no side headline', () => {
    const botSide: HighlightSeat[] = [
      { name: 'Dee', kind: 'user', side: 0 }, { name: 'B1', kind: 'bot', side: 1 },
      { name: 'Kim', kind: 'user', side: 0 }, { name: 'B2', kind: 'bot', side: 1 },
    ];
    const evs = handHighlights({ rec: rec([side(0, 0), side(1, 13)]), seats: botSide, partnerships: true, code: 'TBL9', at: NOW });
    expect(evs).toEqual([]);
  });
});

describe('the bounded store + read route shape', () => {
  let db: D1Database;
  beforeEach(async () => { db = await makeD1(); });
  const ev = (id: string, at: number): HighlightEvent => ({ id, at, type: 'nuke', name: 'Dee', text: `☢ Dee's nuke blew in Hand 1`, code: 'TBL9', hand: 1, marquee: true });

  it('keeps only the latest ~30 and drops stale events on read', async () => {
    for (let i = 0; i < 35; i++) await recordHighlight(db, ev(`e${i}`, NOW + i * 1000));
    const all = await recentHighlights(db, NOW + 34_000, 50);
    expect(all.length).toBe(30);
    expect(all[0]!.id).toBe('e34');
    // 16 minutes later everything is stale for the ticker
    expect(await recentHighlights(db, NOW + 34_000 + 16 * 60_000)).toEqual([]);
  });

  it('the same event id stored twice stays one row (dedupe by id)', async () => {
    await recordHighlight(db, ev('dup', NOW));
    await recordHighlight(db, ev('dup', NOW));
    expect(await recentHighlights(db, NOW)).toHaveLength(1);
  });
});
