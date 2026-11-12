/**
 * The offline table UI always puts "you" in seat 0 at the bottom. Online you can sit anywhere, so the server's
 * per-seat view is rotated into that frame: local seat = (real seat − my seat) mod n. Per-side arrays (scores,
 * bags, hand results) rotate by side. Other players' hands are never sent; they're filled with placeholders of
 * the right length so the renderer can draw card backs.
 */
import type { Card, GameResult, GameState, HandRecord, PlayerView, RenegeCall, SideHandResult, TableRules, Trick } from '@spades/rules';

export interface Rotation {
  n: number;
  me: number;
  /** real seat → local seat */
  L(seat: number): number;
  /** local seat → real seat */
  R(seat: number): number;
  /** real side → local side */
  Ls(side: number): number;
  /** local side → real side */
  Rs(side: number): number;
}

export function rotation(rules: TableRules, me: number): Rotation {
  const n = rules.playerCount;
  const L = (s: number) => (s - me + n * 4) % n;
  const R = (s: number) => (s + me) % n;
  const sides = rules.partnerships ? 2 : n;
  const off = rules.partnerships ? me % 2 : me;
  return { n, me, L, R, Ls: (x) => (x - off + sides * 4) % sides, Rs: (x) => (x + off) % sides };
}

/** out[local] = arr[real] */
export function permute<T>(arr: readonly T[], rot: Rotation, bySide = false): T[] {
  const back = bySide ? rot.Rs : rot.R;
  return arr.map((_, i) => arr[back(i)]!);
}

function rotTrick(t: Trick, rot: Rotation): Trick {
  // keep every play flag (run = 'Run it!', auto = nuke auto-play): the table's effects key off them
  return { leader: rot.L(t.leader), plays: t.plays.map((p) => ({ ...p, seat: rot.L(p.seat) })), winner: t.winner === null ? null : rot.L(t.winner) };
}

function rotSide(s: SideHandResult, rot: Rotation): SideHandResult {
  return { ...s, side: rot.Ls(s.side), seats: s.seats.map(rot.L).sort((a, b) => a - b), nils: s.nils.map((x) => ({ ...x, seat: rot.L(x.seat) })).sort((a, b) => a.seat - b.seat) };
}

/** A renege ruling into the local frame: the two seats rotate as seats, the two sides as sides. The proof cards ride as-is. */
function rotRenegeCall(c: RenegeCall, rot: Rotation): RenegeCall {
  return { ...c, by: rot.L(c.by), target: rot.L(c.target), from: rot.Ls(c.from), to: rot.Ls(c.to) };
}

function rotRecord(h: HandRecord, rot: Rotation): HandRecord {
  return { ...h, dealer: rot.L(h.dealer), bids: permute(h.bids, rot), tricksWon: permute(h.tricksWon, rot), sides: permute(h.sides.map((s) => rotSide(s, rot)), rot, true),
    // a tossed hand's set sides are side indices: they rotate with the sides or the recap blames the wrong team
    ...(h.tossed ? { tossed: { setSides: h.tossed.setSides.map((s) => rot.Ls(s)) } } : {}),
    ...(h.renegeCalls ? { renegeCalls: h.renegeCalls.map((c) => rotRenegeCall(c, rot)) } : {}) };
}

function rotResult(r: GameResult | null, rot: Rotation): GameResult | null {
  if (!r) return null;
  return { ...r, finalScores: permute(r.finalScores, rot, true), placements: permute(r.placements, rot, true), winners: r.winners.map(rot.Ls).sort((a, b) => a - b), ...(r.shotOut ? { shotOut: r.shotOut.map(rot.Ls).sort((a, b) => a - b) } : {}) };
}

/** Placeholder for a hidden card (never rendered face-up). */
export const HIDDEN = 'XX' as Card;

export function rotateView(v: PlayerView): { st: GameState; view: PlayerView; rot: Rotation } {
  const rot = rotation(v.rules, v.seat);
  const handCounts = permute(v.handCounts, rot);
  const hands = handCounts.map((c, i) => (i === 0 && v.hand ? [...v.hand] : Array.from({ length: c }, () => HIDDEN)));
  const st: GameState = {
    rules: v.rules,
    seed: '',
    phase: v.phase,
    handNo: v.handNo,
    dealer: rot.L(v.dealer),
    turn: v.turn === null ? null : rot.L(v.turn),
    hands,
    bids: permute(v.bids, rot),
    revealed: permute(v.revealed, rot),
    exchange: v.exchange.map((e) => ({ ...e, from: rot.L(e.from), to: rot.L(e.to) })),
    trick: rotTrick(v.trick, rot),
    tricks: v.tricks.map((t) => rotTrick(t, rot)),
    tricksWon: permute(v.tricksWon, rot),
    spadesBroken: v.spadesBroken,
    scores: permute(v.scores, rot, true),
    bags: permute(v.bags, rot, true),
    history: (v.history ?? []).map((h) => rotRecord(h, rot)),
    result: rotResult(v.result, rot),
    // Cutthroat seat state must survive rotation, in LOCAL seat order: dropping it (and leaving
    // the view's copy in real-seat order) meant the client rendered a post-ejection hand as if
    // nobody was out — seat/count logic downstream read the wrong seats on first load.
    failStreak: permute(v.failStreak ?? [], rot),
    eliminated: permute(v.eliminated ?? [], rot),
    ...(v.trickCount !== undefined ? { trickCount: v.trickCount } : {}),
  };
  const view: PlayerView = {
    ...v,
    seat: 0,
    dealer: st.dealer,
    turn: st.turn,
    handCounts,
    bids: st.bids,
    revealed: st.revealed,
    exchange: st.exchange,
    trick: st.trick,
    tricks: st.tricks,
    tricksWon: st.tricksWon,
    scores: st.scores,
    bags: st.bags,
    history: st.history,
    result: st.result,
    failStreak: st.failStreak ?? [],
    eliminated: st.eliminated ?? [],
    // 'Run it!' cleared hands are public only after the claim; rotate them with the rest of the seats.
    ...(v.runHands ? { runHands: permute(v.runHands, rot) } : {}),
    // A called misdeal's thrown hand is face up for the whole table: the cards ride as-is (public),
    // only the caller's seat moves into the local frame.
    ...(v.misdealReveal ? { misdealReveal: { seat: rot.L(v.misdealReveal.seat), cards: v.misdealReveal.cards } } : {}),
    // The toss offer is public table state; its sides rotate into the local frame like the scores do.
    toss: v.toss ? { setSides: v.toss.setSides.map((s) => rot.Ls(s)), points: permute(v.toss.points, rot, true) } : null,
    // Renege tables: the rulings are public and the callable books name seats — both move into the local frame.
    ...(v.renege ? { renege: { calls: v.renege.calls.map((c) => rotRenegeCall(c, rot)), open: v.renege.open.map((b) => ({ trick: b.trick, targets: b.targets.map((s) => rot.L(s)) })) } } : {}),
  };
  return { st, view, rot };
}
