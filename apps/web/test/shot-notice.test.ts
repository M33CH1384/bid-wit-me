import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type Bid, type GameState, type HandRecord, isShot, makeRules, newGame, scoreHand } from '@spades/rules';
import { SHOT_OUT_NAMES, endReasonText, onNoticeSides, shotArms, shotChatLines, shotOutBannerFor, shotOutEndingName, shotOutPathFor, stickyNoticeSides } from '../src/shotOut';
import { resultChips } from '../src/ScorePad';
import { noticeStickyTip, noticeTip } from '../src/seatLabel';

/**
 * Sticky second notice (owner, 2026-10-28): the display derivation. First notice shows only
 * right after the shot hand and clears on a make; the second (sticky) notice stays displayed
 * — plates, score pad — for the rest of the game. State derives from history alone, so a
 * save/resume round-trip restores it exactly.
 */
const joker = makeRules('joker');

const MADE = { bids: [3, 3, 3, 3] as Bid[], tricks: [4, 3, 3, 3] };
const SET0 = { bids: [4, 3, 2, 3] as Bid[], tricks: [3, 3, 1, 6] }; // side 0 set

/** A scored record the way finishHand writes it (shot stamps included). */
function rec(handNo: number, bids: Bid[], tricks: number[], rules = joker): HandRecord {
  const sides = scoreHand(rules, bids, tricks, Array(rules.partnerships ? 2 : rules.playerCount).fill(0), Array(rules.partnerships ? 2 : rules.playerCount).fill(0))
    .map((s) => ({ ...s, shot: isShot(rules, bids, s) }));
  return { handNo, dealer: 3, bids: [...bids], tricksWon: [...tricks], sides };
}

function st(history: HandRecord[], rules = joker, phase: GameState['phase'] = 'handOver'): GameState {
  return { ...newGame(rules, 'notice'), history, phase, result: null };
}

/** The owner timeline for side 0: set, made, set, made — then the game goes on. */
const timeline = [rec(1, MADE.bids, MADE.tricks), rec(2, SET0.bids, SET0.tricks), rec(3, MADE.bids, MADE.tricks), rec(4, SET0.bids, SET0.tricks), rec(5, MADE.bids, MADE.tricks)];

describe('notice derivation', () => {
  it('first notice: shows after the shot hand, clears on the make', () => {
    expect(onNoticeSides(st(timeline.slice(0, 2)))).toEqual([0]);
    expect(stickyNoticeSides(st(timeline.slice(0, 2)))).toEqual([]);
    expect(onNoticeSides(st(timeline.slice(0, 3)))).toEqual([]); // made hand: cleared
    expect(stickyNoticeSides(st(timeline.slice(0, 3)))).toEqual([]);
  });
  it('second notice: arms sticky and STAYS displayed through a made hand', () => {
    expect(shotArms(joker, timeline)).toEqual([2, 0]);
    expect(stickyNoticeSides(st(timeline.slice(0, 4)))).toEqual([0]);
    expect(onNoticeSides(st(timeline))).toEqual([0]); // hand 5 was MADE — still on notice
    expect(stickyNoticeSides(st(timeline))).toEqual([0]);
  });
  it('a save/resume round-trip restores the sticky display exactly', () => {
    const revived = JSON.parse(JSON.stringify(st(timeline))) as GameState;
    expect(onNoticeSides(revived)).toEqual([0]);
    expect(stickyNoticeSides(revived)).toEqual([0]);
  });
  it('nothing shows once the game is over, or when Shot = out is off', () => {
    expect(onNoticeSides(st(timeline, joker, 'gameOver'))).toEqual([]);
    expect(stickyNoticeSides(st(timeline, joker, 'gameOver'))).toEqual([]);
    const off = makeRules('joker', { shotOut: false });
    const offTimeline = [rec(1, MADE.bids, MADE.tricks, off), rec(2, SET0.bids, SET0.tricks, off), rec(3, MADE.bids, MADE.tricks, off), rec(4, SET0.bids, SET0.tricks, off), rec(5, MADE.bids, MADE.tricks, off)];
    expect(onNoticeSides(st(offTimeline, off))).toEqual([]);
    expect(stickyNoticeSides(st(offTimeline, off))).toEqual([]);
  });
  it('cutthroat: the same stickiness holds per player, counting stamped nil-bust fails', () => {
    const ct = makeRules('cutthroat', { playerCount: 4 });
    // player 0 busts a Nil twice (hands 2 and 4) with a clean hand between; finishCutthroat
    // stamps those fails `shot` even though isShot's nil clause is partnerships-only.
    const bust = (handNo: number): HandRecord => {
      const base = rec(handNo, ['nil', 3, 3, 3], [1, 4, 4, 4], ct);
      return { ...base, sides: base.sides.map((s) => (s.side === 0 ? { ...s, shot: true } : s)) };
    };
    const clean = rec(3, [3, 3, 3, 3], [4, 3, 3, 3], ct);
    const made5 = rec(5, [3, 3, 3, 3], [4, 3, 3, 3], ct);
    const hist = [rec(1, [3, 3, 3, 3], [4, 3, 3, 3], ct), bust(2), clean, bust(4), made5];
    expect(shotArms(ct, hist)[0]).toBe(2);
    expect(stickyNoticeSides(st(hist, ct))).toEqual([0]); // still up after the made hand 5
    expect(onNoticeSides(st(hist, ct))).toEqual([0]);
  });
});

describe('score pad chip', () => {
  const chipsFor = (history: HandRecord[]) => {
    const last = history[history.length - 1]!;
    return resultChips(joker, last, last.sides[0]!, { result: null, history }).map((c) => c.text);
  };
  it('the arming hand reads SHOT · ON NOTICE, and a later made hand still reads ON NOTICE', () => {
    expect(chipsFor(timeline.slice(0, 4))).toContain('SHOT · ON NOTICE');
    expect(chipsFor(timeline)).toContain('ON NOTICE'); // hand 5 made — the pad keeps the notice up
  });
  it('a first notice does NOT linger on a made hand', () => {
    expect(chipsFor(timeline.slice(0, 3))).not.toContain('ON NOTICE');
    expect(chipsFor(timeline.slice(0, 3))).not.toContain('SHOT · ON NOTICE');
  });
});

describe('chat lines stay truthful', () => {
  const label = (side: number) => `Side ${side}`;
  it('the first arming keeps the plain line; the second arming says it never clears', () => {
    const first = shotChatLines(joker, timeline[1]!, { result: null, history: timeline.slice(0, 2) }, label);
    expect(first).toEqual(['⚠ Side 0 got shot · ON NOTICE: one more and they\'re out']);
    const second = shotChatLines(joker, timeline[3]!, { result: null, history: timeline.slice(0, 4) }, label);
    expect(second).toEqual(['⚠ Side 0 got shot · ON NOTICE FOR GOOD: one more shot and they\'re out — making their books won\'t clear it']);
  });
});

describe('game-over sentence for a sticky ending', () => {
  const label = (side: number) => `Side ${side}`;
  const over = (history: HandRecord[]): GameState => ({
    ...st(history), phase: 'gameOver',
    result: { endReason: 'shotOut', shotOut: [0], finalScores: [40, 120], placements: [2, 1], winners: [1] },
  });
  it('across a gap it says "on notice for good", not "two hands in a row"', () => {
    // last hand shot side 0 out; the hand before it was a MAKE for side 0 — a sticky ending
    const hist = [...timeline, rec(6, SET0.bids, SET0.tricks)];
    expect(endReasonText(joker, over(hist), label)).toBe('Side 0 got shot while on notice for good.');
  });
  it('back-to-back shots keep the classic wording', () => {
    const hist = [rec(1, MADE.bids, MADE.tricks), rec(2, SET0.bids, SET0.tricks), rec(3, SET0.bids, SET0.tricks)];
    expect(endReasonText(joker, over(hist), label)).toBe('Side 0 got shot two hands in a row.');
  });
});

describe('ending names (owner, 2026-10-28): 3 the hard way is only for three sets', () => {
  const label = (side: number) => `Side ${side}`;
  const SET1 = { bids: [3, 5, 3, 3] as Bid[], tricks: [4, 2, 3, 4] }; // side 1 set, side 0 made
  const SETBOTH = { bids: [5, 5, 3, 3] as Bid[], tricks: [3, 3, 3, 4] }; // both sides set
  const overWith = (history: HandRecord[], shotOut: number[], rules = joker): GameState => ({
    ...st(history, rules), phase: 'gameOver',
    result: { endReason: 'shotOut', shotOut, finalScores: [40, 120], placements: [2, 1], winners: [1] },
  });
  const chatFor = (history: HandRecord[], shotOut: number[], rules = joker) =>
    shotChatLines(rules, history[history.length - 1]!, { result: { endReason: 'shotOut', shotOut, finalScores: [40, 120], placements: [2, 1], winners: [1] }, history }, label);

  it('the name map carries exactly the owner’s three names', () => {
    expect(SHOT_OUT_NAMES).toEqual({ 'first-hand': '1ST ROUND TKO', 'back-to-back': 'SHOT BACK 2 BACK', sticky: 'SHOT OUT' });
  });

  it('hand 1: the path, the banner and the chat call all say 1ST ROUND TKO', () => {
    const hist = [rec(1, SET0.bids, SET0.tricks)];
    expect(shotOutPathFor(hist, 0)).toBe('first-hand');
    expect(shotOutEndingName(hist, 0)).toBe('1ST ROUND TKO');
    expect(shotOutBannerFor(overWith(hist, [0]))).toBe('1ST ROUND TKO');
    expect(chatFor(hist, [0])).toEqual(['💀 1ST ROUND TKO: Side 0 got shot on the first hand']);
  });

  it('two in a row: the path, the banner and the chat call all say SHOT BACK 2 BACK', () => {
    const hist = [rec(1, MADE.bids, MADE.tricks), rec(2, SET0.bids, SET0.tricks), rec(3, SET0.bids, SET0.tricks)];
    expect(shotOutPathFor(hist, 0)).toBe('back-to-back');
    expect(shotOutEndingName(hist, 0)).toBe('SHOT BACK 2 BACK');
    expect(shotOutBannerFor(overWith(hist, [0]))).toBe('SHOT BACK 2 BACK');
    expect(chatFor(hist, [0])).toEqual(['💀 SHOT BACK 2 BACK: Side 0 got shot two hands in a row']);
  });

  it('sticky across a gap: no special name — plain SHOT OUT everywhere', () => {
    // side 0 shot on hands 2 and 4 (sticky armed), made hand 5, shot out on hand 6
    const hist = [...timeline, rec(6, SET0.bids, SET0.tricks)];
    expect(shotOutPathFor(hist, 0)).toBe('sticky');
    expect(shotOutEndingName(hist, 0)).toBe('SHOT OUT');
    expect(shotOutBannerFor(overWith(hist, [0]))).toBe('SHOT OUT');
    expect(chatFor(hist, [0])).toEqual(['💀 SHOT OUT: Side 0 got shot while on notice for good']);
  });

  it('both sides out on the same hand by the SAME path share that path’s name on the banner', () => {
    const hist = [rec(1, MADE.bids, MADE.tricks), rec(2, SETBOTH.bids, SETBOTH.tricks), rec(3, SETBOTH.bids, SETBOTH.tricks)];
    expect(shotOutBannerFor(overWith(hist, [0, 1]))).toBe('SHOT BACK 2 BACK');
  });

  it('both sides out on the same hand by DIFFERENT paths: banner falls back to SHOT OUT, chat names each side’s own path', () => {
    // side 0: shot hands 2 + 4 (sticky), made hand 5, out hand 6. side 1: first shot hand 5, out hand 6.
    const hist = [
      rec(1, MADE.bids, MADE.tricks), rec(2, SET0.bids, SET0.tricks), rec(3, MADE.bids, MADE.tricks),
      rec(4, SET0.bids, SET0.tricks), rec(5, SET1.bids, SET1.tricks), rec(6, SETBOTH.bids, SETBOTH.tricks),
    ];
    expect(shotOutPathFor(hist, 0)).toBe('sticky');
    expect(shotOutPathFor(hist, 1)).toBe('back-to-back');
    expect(shotOutBannerFor(overWith(hist, [0, 1]))).toBe('SHOT OUT');
    expect(chatFor(hist, [0, 1])).toEqual([
      '💀 SHOT OUT: Side 0 got shot while on notice for good',
      '💀 SHOT BACK 2 BACK: Side 1 got shot two hands in a row',
    ]);
  });

  it('the banner reads the FINAL hand’s out rows even if the result list names an earlier side too', () => {
    // the final record stamps side 0 out; the result list also names side 1 (an earlier
    // elimination, cutthroat-style) — the ending’s name is side 0’s alone
    const base = [rec(1, MADE.bids, MADE.tricks), rec(2, SET0.bids, SET0.tricks), rec(3, SET0.bids, SET0.tricks)];
    const last = base[2]!;
    const hist = [...base.slice(0, 2), { ...last, sides: last.sides.map((s) => (s.side === 0 ? { ...s, out: true } : s)) }];
    expect(shotOutBannerFor(overWith(hist, [0, 1]))).toBe('SHOT BACK 2 BACK');
  });

  it('cutthroat: the same facts name a player’s elimination (back-to-back → SHOT BACK 2 BACK, sticky → SHOT OUT)', () => {
    const ct = makeRules('cutthroat', { playerCount: 4 });
    const setP0 = { bids: [4, 3, 3, 3] as Bid[], tricks: [2, 4, 4, 3] }; // player 0 set
    const clean = { bids: [3, 3, 3, 3] as Bid[], tricks: [4, 3, 3, 3] };
    const b2b = [rec(1, clean.bids, clean.tricks, ct), rec(2, setP0.bids, setP0.tricks, ct), rec(3, setP0.bids, setP0.tricks, ct)];
    expect(shotOutPathFor(b2b, 0)).toBe('back-to-back');
    expect(shotOutBannerFor(overWith(b2b, [0], ct))).toBe('SHOT BACK 2 BACK');
    const sticky = [rec(1, clean.bids, clean.tricks, ct), rec(2, setP0.bids, setP0.tricks, ct), rec(3, clean.bids, clean.tricks, ct), rec(4, setP0.bids, setP0.tricks, ct), rec(5, clean.bids, clean.tricks, ct), rec(6, setP0.bids, setP0.tricks, ct)];
    expect(shotOutPathFor(sticky, 0)).toBe('sticky');
    expect(shotOutBannerFor(overWith(sticky, [0], ct))).toBe('SHOT OUT');
  });

  it('both game-over views stamp the shared banner helper — no literal SHOT OUT banner remains', () => {
    const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    expect(table.split('shotOutBannerFor(st)').length - 1).toBe(2);
    expect(table).not.toContain('data-testid="shot-out">SHOT OUT<');
  });
});

describe('avatar plate caution dressing (owner: the plate, not the pad)', () => {
  const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  it('both plate sites dress by SIDE (so both partners wear it) from the sticky derivation', () => {
    expect(table).toContain('const stickyNotice = stickyNoticeSides(sb);');
    expect(table).toContain("stickyNotice.includes(sideOf(seat, r)) ? ' caution' : ''"); // seat plates
    expect(table).toContain("stickyNotice.includes(sideOf(HUMAN, r)) ? ' caution' : ''"); // the human's own plate
    expect(table).toContain('noticeStickyTip');
  });
  it('the caution treatment is a hazard-stripe frame on the plate, theme-independent', () => {
    expect(css).toContain('.plate.caution::before');
    expect(css).toContain('repeating-linear-gradient(45deg, #ffd21f 0 11px, #161616 11px 22px)');
    expect(css).toContain('mask-composite: exclude');
  });
  it('the sticky tooltip says the notice never clears; the first-notice tip is unchanged', () => {
    expect(noticeStickyTip(false)).toContain("won't clear it");
    expect(noticeStickyTip(true)).toContain("won't clear it");
    expect(noticeTip(false)).toBe("Got shot last hand: one more shot and you're out");
  });
});
