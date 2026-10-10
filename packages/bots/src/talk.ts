/**
 * Bot trash talk engine (pure; the server and the offline game both drive it, so online lines come from the server).
 * - Event-driven: the caller reports a moment (a cut, a set, a nuke…); the engine picks who (if anyone) talks.
 * - Cooldowns: one bot line at a time (global gap), each bot rests between lines; big moments get a shorter gap.
 * - Pre-play lines never see the card about to be played (no tells): prePlayLine() takes no card/hand at all.
 * - Hustler persona plays dumb ('newbie' pool) until it pulls off a cut / lead-taking spade / set, then reveals once.
 */
import { COMMON, PERSONAS, type PersonaId, type TalkKind, personaForName } from './personas';

export { COMMON, PERSONAS, personaForName };
export type { PersonaId, TalkKind };

export const TALK = {
  /** min gap between any two bot lines */
  globalGapMs: 3500,
  /** big moments (nuke, wheels, win/lose, reveal) only need this gap */
  bigGapMs: 1200,
  /** a bot rests this long after speaking */
  seatGapMs: 9000,
  /** base chance a moment produces a line (× persona freq) */
  chance: {
    prePlay: 0.12, cut: 0.55, gotCut: 0.3, overcut: 0.7, joker: 0.45, nuke: 1, gotNuked: 0.8, setThem: 0.85, gotSet: 0.4,
    made: 0.3, bigBid: 0.5, roastBid: 0.35, wheels: 0.95, nilMade: 0.7, nilBust: 0.8, bags: 0.6, duck: 0.18, slow: 0.6,
    streak: 0.5, runIt: 1, gotRan: 0.6, win: 1, lose: 0.9, rematch: 0.8, hypePartner: 0.55, newbie: 0.3, reveal: 1,
  } as Record<TalkKind, number>,
  recentMax: 14,
};
const BIG: TalkKind[] = ['nuke', 'gotNuked', 'wheels', 'runIt', 'win', 'lose', 'reveal', 'rematch'];
/** the losing side's take on a moment */
const MIRROR: Partial<Record<TalkKind, TalkKind>> = { cut: 'gotCut', overcut: 'gotCut', nuke: 'gotNuked', setThem: 'gotSet', win: 'lose', runIt: 'gotRan' };
/** moments where the Hustler drops the act (when it did it) */
const REVEAL_ON: TalkKind[] = ['cut', 'overcut', 'setThem'];
/** a human did something good: their bot partner may hype them */
const HYPE_ON: TalkKind[] = ['cut', 'overcut', 'joker', 'nuke', 'setThem', 'nilMade', 'wheels', 'made', 'runIt'];

export interface TalkSeat { bot: boolean; name: string }
export interface TalkTable {
  seats: TalkSeat[];
  partnerships: boolean;
  /** per side display name */
  teamNames: string[];
}
export interface TalkState { lastAt: number; seatAt: number[]; revealed: number[]; recent: string[] }
export interface TalkEvent {
  kind: TalkKind;
  /** the side that did it / benefited (for MIRROR kinds the other side may answer) */
  side?: number;
  /** the seat that did it */
  seat?: number;
  /** the seat the line is about ({them}); defaults to the actor or a player on the other side */
  them?: number;
  card?: string;
  bid?: number;
  gap?: number;
}
export interface TalkLine { seat: number; name: string; text: string; persona: PersonaId; reveal?: boolean }

export function newTalkState(): TalkState { return { lastAt: -1e12, seatAt: [], revealed: [], recent: [] }; }

export const sideOfSeat = (t: TalkTable, seat: number) => (t.partnerships ? seat % 2 : seat);
const sideCount = (t: TalkTable) => (t.partnerships ? 2 : t.seats.length);

export function personaOf(t: TalkTable, seat: number): PersonaId { return personaForName(t.seats[seat]?.name ?? ''); }

/** Tag for the bot's plate tooltip (the Hustler wears a fake one until revealed). */
export function personaTag(name: string, revealed: boolean): string {
  const p = PERSONAS[personaForName(name)];
  return !revealed && p.fakeTag ? p.fakeTag : p.tag;
}

export function cardWords(c: string | undefined): string {
  if (!c) return 'that card';
  if (c === 'BJ') return 'Big Joker'; if (c === 'LJ') return 'Little Joker';
  const r = c.slice(0, -1), s = c.slice(-1);
  const R: Record<string, string> = { A: 'Ace', K: 'King', Q: 'Queen', J: 'Jack', T: '10' };
  const S: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
  return `${R[r] ?? r}${S[s] ?? ''}`;
}

function fill(text: string, t: TalkTable, speaker: number, ev: TalkEvent, them: number | undefined): string {
  const side = sideOfSeat(t, speaker);
  const opp = t.partnerships ? 1 - side : (them !== undefined ? sideOfSeat(t, them) : (side + 1) % sideCount(t));
  const partner = t.partnerships ? (speaker + 2) % t.seats.length : speaker;
  return text
    .replace(/\{me\}/g, t.seats[speaker]?.name ?? 'me')
    .replace(/\{them\}/g, them !== undefined ? (t.seats[them]?.name ?? 'you') : 'y\'all')
    .replace(/\{partner\}/g, t.seats[partner]?.name ?? 'partner')
    .replace(/\{team\}/g, t.teamNames[side] ?? 'us')
    .replace(/\{opp\}/g, t.teamNames[opp] ?? 'y\'all')
    .replace(/\{card\}/g, cardWords(ev.card))
    .replace(/\{bid\}/g, String(ev.bid ?? 'that many'))
    .replace(/\{gap\}/g, String(Math.abs(ev.gap ?? 0)));
}

function pick(st: TalkState, persona: PersonaId, kind: TalkKind, rnd: () => number): string | null {
  const own = PERSONAS[persona].lines[kind] ?? [];
  const common = persona === 'silent' || persona === 'hustler' && (kind === 'newbie' || kind === 'reveal') ? [] : (COMMON[kind] ?? []);
  // persona lines weigh double; skip anything said recently
  const pool = [...own, ...own, ...common].filter((l) => !st.recent.includes(l));
  const list = pool.length ? pool : [...own, ...common];
  if (!list.length) return null;
  return list[Math.floor(rnd() * list.length)]!;
}

function say(st: TalkState, t: TalkTable, seat: number, kind: TalkKind, ev: TalkEvent, them: number | undefined, now: number, rnd: () => number, reveal = false): TalkLine | null {
  const persona = personaOf(t, seat);
  const raw = pick(st, persona, kind, rnd);
  if (!raw) return null;
  st.recent = [...st.recent, raw].slice(-TALK.recentMax);
  st.lastAt = now;
  st.seatAt[seat] = now;
  let text = fill(raw, t, seat, ev, them);
  if (PERSONAS[persona].caps) text = text.toUpperCase();
  return { seat, name: t.seats[seat]!.name, text, persona, ...(reveal ? { reveal: true } : {}) };
}

const ready = (st: TalkState, seat: number, now: number, big: boolean) => now - (st.seatAt[seat] ?? -1e12) >= (big ? TALK.bigGapMs : TALK.seatGapMs);

/** React to a moment. Returns at most one line (or null), and updates the cooldown state. */
export function botTalk(st: TalkState, t: TalkTable, ev: TalkEvent, now: number, rnd: () => number): TalkLine | null {
  const bots = t.seats.map((s, i) => (s.bot ? i : -1)).filter((i) => i >= 0);
  if (!bots.length) return null;
  const big = BIG.includes(ev.kind);
  if (now - st.lastAt < (big ? TALK.bigGapMs : TALK.globalGapMs)) return null;
  const actor = ev.seat;
  const side = ev.side ?? (actor !== undefined ? sideOfSeat(t, actor) : undefined);
  const onSide = (s: number) => side !== undefined && sideOfSeat(t, s) === side;
  const otherThem = (speaker: number) => ev.them ?? (actor !== undefined && sideOfSeat(t, actor) !== sideOfSeat(t, speaker) ? actor : t.seats.findIndex((_, i) => side !== undefined && !onSide(i) && i !== speaker));

  // the Hustler drops the act when it pulls one off itself (once)
  if (actor !== undefined && t.seats[actor]?.bot && personaOf(t, actor) === 'hustler' && !st.revealed.includes(actor) && REVEAL_ON.includes(ev.kind)) {
    st.revealed = [...st.revealed, actor];
    return say(st, t, actor, 'reveal', ev, otherThem(actor), now, rnd, true);
  }

  // a human on a bot's team did something good → the bot partner hypes them
  if (t.partnerships && actor !== undefined && !t.seats[actor]?.bot && HYPE_ON.includes(ev.kind)) {
    const p = (actor + 2) % t.seats.length;
    if (t.seats[p]?.bot && ready(st, p, now, big) && rnd() < TALK.chance.hypePartner * freqOf(st, t, p)) return speak(st, t, p, 'hypePartner', ev, actor, now, rnd);
  }

  // who talks: the actor (if a bot), else a bot on the benefiting side; for MIRROR kinds sometimes the other side answers
  let kind = ev.kind;
  let cands: number[];
  if (kind === 'duck' || kind === 'roastBid') cands = bots.filter((b) => !onSide(b));
  else if (kind === 'slow' || kind === 'rematch' || kind === 'prePlay') cands = bots;
  else {
    // 'runIt' lines are first person ('the rest are mine'): only the bot that ran it says them; otherwise the other side answers
    cands = actor !== undefined && t.seats[actor]?.bot ? [actor] : kind === 'runIt' ? [] : bots.filter(onSide);
    const mirror = MIRROR[kind];
    const others = bots.filter((b) => !onSide(b));
    if (mirror && others.length && (!cands.length || rnd() > 0.7)) { kind = mirror; cands = others; }
  }
  cands = cands.filter((c) => ready(st, c, now, big) && (personaOf(t, c) !== 'silent' || kind === 'cut' || kind === 'setThem' || kind === 'overcut'));
  if (!cands.length) return null;
  const seat = cands[Math.floor(rnd() * cands.length)]!;
  if (rnd() >= (TALK.chance[kind] ?? 0.3) * freqOf(st, t, seat)) return null;
  const them = kind === 'slow' ? ev.them : otherThem(seat);
  return speak(st, t, seat, kind, ev, them === -1 ? undefined : them, now, rnd);
}

function freqOf(_st: TalkState, t: TalkTable, seat: number): number { return PERSONAS[personaOf(t, seat)].freq; }

/** Hustler still acting → everything comes out of the 'newbie' pool. */
function speak(st: TalkState, t: TalkTable, seat: number, kind: TalkKind, ev: TalkEvent, them: number | undefined, now: number, rnd: () => number): TalkLine | null {
  const acting = personaOf(t, seat) === 'hustler' && !st.revealed.includes(seat);
  return say(st, t, seat, acting ? 'newbie' : kind, ev, them, now, rnd);
}

/**
 * Maybe say something BEFORE this bot plays. Deliberately takes no card or hand: the line can't be a tell.
 * The caller adds a short beat before the card lands when a line comes back.
 */
export function prePlayLine(st: TalkState, t: TalkTable, seat: number, now: number, rnd: () => number): TalkLine | null {
  if (!t.seats[seat]?.bot || personaOf(t, seat) === 'silent') return null;
  if (now - st.lastAt < TALK.globalGapMs || !ready(st, seat, now, false)) return null;
  if (rnd() >= TALK.chance.prePlay * freqOf(st, t, seat)) return null;
  return speak(st, t, seat, 'prePlay', { kind: 'prePlay' }, undefined, now, rnd);
}

/** Persona bid lean: sometimes nudge a numeric bid by the persona's lean (±1), Hustler only while acting. Never below 1. */
export function leanBid(bid: number, name: string, revealed: boolean, rnd: () => number): number {
  const p = PERSONAS[personaForName(name)];
  if (p.lean.bid === 0 || (p.id === 'hustler' && revealed)) return bid;
  if (p.lean.bid < 0 && bid >= 3 && rnd() < 0.5) return bid - 1;
  if (p.lean.bid > 0 && bid >= 2 && bid <= 6 && rnd() < 0.3) return bid + 1;
  return bid;
}

/** Nil lean: a persona that dislikes Nil sometimes turns a (non-blind) Nil into a 1 bid. */
export function leanNil(name: string, rnd: () => number): boolean {
  const p = PERSONAS[personaForName(name)];
  return p.lean.nil < 0 && rnd() < -p.lean.nil * 0.5;
}

/** "Clean talk": mask mild cursing (sh*t, a**, d*mn, h*ll). */
export function maskMild(s: string): string {
  return s
    .replace(/\b(shit)/gi, (w) => `${w.slice(0, 2)}*${w.slice(3)}`)
    .replace(/\b(ass)\b/gi, (w) => `${w[0]}**`)
    .replace(/\b(damn)/gi, (w) => `${w[0]}*${w.slice(2)}`)
    .replace(/\b(hell)\b/gi, (w) => `${w[0]}*${w.slice(2)}`);
}
