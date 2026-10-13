/**
 * Bot trash talk engine (pure; the server and the offline game both drive it, so online lines come from the server).
 * - Event-driven: the caller reports a moment (a cut, a set, a nuke…); the engine picks who (if anyone) talks.
 * - Cooldowns: one bot line at a time (global gap), each bot rests between lines; big moments get a shorter gap.
 * - Pre-play lines never see the card about to be played (no tells): prePlayLine() takes no card/hand at all.
 * - Hustler persona plays dumb ('newbie' pool) until it pulls off a cut / lead-taking spade / set, then reveals once.
 */
import { COMMON, LINE_META, PACK_OWNERS, PERSONAS, type LineMeta, type PersonaId, type TalkIntensity, type TalkKind, lineAllowed, lineFitsGender, personaForName, personaSkillFloor } from './personas';
import { possessive, voiceGender } from './names';
import { BOT_SKILLS, type BotSkill, seatSkill } from './bidding';

export { COMMON, LINE_META, PACK_OWNERS, PERSONAS, lineAllowed, personaForName, personaSkillFloor };
export type { LineMeta, PersonaId, TalkIntensity, TalkKind };
export const TALK_INTENSITY_LABEL: Record<TalkIntensity, string> = { family: 'Family Friendly', cookout: 'Cookout', nomercy: 'No Mercy' };

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
    slam: 0.3, partnerBlunder: 0.7, bidTooHigh: 0.5, nilBid: 0.6, blindNil: 0.9, boston: 1, loudLoser: 0.8, badHand: 0.35, roast: 0.5,
    onNotice: 0.8, shotOut: 1,
  } as Record<TalkKind, number>,
  recentMax: 14,
};
const BIG: TalkKind[] = ['nuke', 'gotNuked', 'wheels', 'runIt', 'win', 'lose', 'reveal', 'rematch', 'boston', 'shotOut', 'blindNil'];
/** the Silent Assassin only speaks for these */
const SILENT_KINDS: TalkKind[] = ['cut', 'setThem', 'overcut', 'runIt', 'win', 'slam'];
/** the losing side's take on a moment */
const MIRROR: Partial<Record<TalkKind, TalkKind>> = { cut: 'gotCut', overcut: 'gotCut', nuke: 'gotNuked', setThem: 'gotSet', win: 'lose', runIt: 'gotRan', partnerBlunder: 'roast' };
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
  /** host's trash-talk intensity (default Cookout) */
  intensity?: TalkIntensity;
  /** Joker deck (gates '@jk' lines) */
  jokers?: boolean;
  /** Live: spades have been broken. Read at the moment a line is chosen. Gates '@unbroken'. */
  spadesBroken?: boolean;
}
export interface TalkState {
  lastAt: number; seatAt: number[]; revealed: number[]; recent: string[];
  /** anti-repeat memory for the whole game: lines already said per `persona:kind` pool (a pool resets once mostly used) */
  used?: Record<string, string[]>;
  /** the last raw line said at this table (never twice in a row) */
  last?: string;
}
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
  /** an Ace got cut (gates '@ace' lines; they're preferred when true) */
  ace?: boolean;
  /** the target side is below zero (gates '@neg' lines) */
  neg?: boolean;
}
/** `line`: stable id of the raw line, `<pool>.<kind>.<index>` (pool = persona id or 'common'): clients map it to a recorded clip */
export interface TalkLine { seat: number; name: string; text: string; persona: PersonaId; reveal?: boolean; line?: string; /** the bid number in a '{bid}' line (picks the numbered clip) */ bid?: number }

/** The id of a raw (unfilled) line as picked for this persona + kind. */
export function lineIdOf(persona: PersonaId, kind: TalkKind, raw: string): string | undefined {
  const own = PERSONAS[persona].lines[kind] ?? [];
  if (own.includes(raw)) return `${persona}.${kind}.${own.indexOf(raw)}`;
  const common = COMMON[kind] ?? [];
  return common.includes(raw) ? `common.${kind}.${common.indexOf(raw)}` : undefined;
}

/** The raw line behind a line id (undefined if this build doesn't have it). */
export function lineById(id: string): string | undefined {
  const [pool, kind, idx] = id.split('.');
  if (!pool || !kind || idx === undefined) return undefined;
  const list = pool === 'common' ? COMMON[kind as TalkKind] : PERSONAS[pool as PersonaId]?.lines[kind as TalkKind];
  return list?.[Number(idx)];
}

export function newTalkState(): TalkState { return { lastAt: -1e12, seatAt: [], revealed: [], recent: [], used: {} }; }

export const sideOfSeat = (t: TalkTable, seat: number) => (t.partnerships ? seat % 2 : seat);
const sideCount = (t: TalkTable) => (t.partnerships ? 2 : t.seats.length);

export function personaOf(t: TalkTable, seat: number): PersonaId { return personaForName(t.seats[seat]?.name ?? ''); }

/** Tag for the bot's plate tooltip (the Hustler wears a fake one until revealed). */
export function personaTag(name: string, revealed: boolean): string {
  const p = PERSONAS[personaForName(name)];
  if (!revealed && p.fakeTag) return p.fakeTag;
  return (voiceGender(name) === 'f' ? p.tagF : p.tagM) ?? p.tag;
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
    .replace(/\{their\}/g, them !== undefined ? possessive(t.seats[them]?.bot ? t.seats[them]?.name : undefined) : 'their')
    .replace(/\{bid\}/g, String(ev.bid ?? 'that many'))
    .replace(/\{gap\}/g, String(Math.abs(ev.gap ?? 0)));
}

/** does a line's condition hold for this event? */
function condOk(meta: LineMeta | undefined, ev: TalkEvent, t: TalkTable): boolean {
  switch (meta?.cond) {
    case undefined: return true;
    case 'ace': return !!ev.ace;
    case 'neg': return !!ev.neg;
    case 'big': return ev.card === 'BJ';
    case 'little': return ev.card === 'LJ';
    case 'jk': return t.jokers !== false;
    case 'unbroken': return t.spadesBroken !== true;
  }
}

/** Raw lines a persona draws on for a kind: its own pool, plus COMMON when its own pool is thin (< 3 at this intensity).
 * `self` is the speaking bot's gender (its name's voice gender): gendered self-references ("mama's thinking") only go to
 * bots of that gender. `target` is the gender of the bot the line is about (undefined for a human: never gendered). */
/** Lines that only make sense with partners ("sorry partner", "{team}", "your teammate"): never said in no-teams modes. */
export const PARTNER_LINE = /partner|team ?mate|\{team\}|\b(my|your|whole|our) team\b/i;
export function mentionsPartner(raw: string): boolean { return PARTNER_LINE.test(raw); }

export function poolFor(persona: PersonaId, kind: TalkKind, intensity: TalkIntensity = 'cookout', self?: 'f' | 'm', target?: 'f' | 'm', teams = true): string[] {
  const ok = (l: string) => lineAllowed(l, intensity) && lineFitsGender(l, self, target) && (teams || !mentionsPartner(l));
  const own = (PERSONAS[persona].lines[kind] ?? []).filter(ok);
  const noCommon = persona === 'silent' || (persona === 'hustler' && (kind === 'newbie' || kind === 'reveal'));
  if (noCommon || own.length >= 3) return own;
  return [...own, ...(COMMON[kind] ?? []).filter(ok)];
}

/** Every raw line a persona's `gender` voice can ever say (any intensity, condition or target): what gets a recorded clip. */
export function speakableLines(persona: PersonaId, gender?: 'f' | 'm'): { kind: TalkKind; raw: string; id: string; self?: 'f' | 'm' }[] {
  const out: { kind: TalkKind; raw: string; id: string; self?: 'f' | 'm' }[] = [];
  const seen = new Set<string>();
  const kinds = new Set<TalkKind>([...Object.keys(PERSONAS[persona].lines), ...Object.keys(COMMON)] as TalkKind[]);
  const genders = gender ? [gender] : (['f', 'm'] as const);
  for (const kind of kinds) {
    const lines = genders.flatMap((g) => (['family', 'cookout', 'nomercy'] as const).flatMap((i) =>
      [...poolFor(persona, kind, i, g, undefined), ...poolFor(persona, kind, i, g, 'f'), ...poolFor(persona, kind, i, g, 'm')]));
    for (const raw of [...new Set(lines)]) {
      const id = lineIdOf(persona, kind, raw)!;
      if (seen.has(id)) continue;
      seen.add(id);
      const self = LINE_META[raw]?.self;
      out.push({ kind, raw, id, ...(self ? { self } : {}) });
    }
  }
  return out;
}

/** gender of the bot sitting in a seat (its name's voice gender), undefined for a human */
function botGender(t: TalkTable, seat: number | undefined): 'f' | 'm' | undefined {
  const s = seat === undefined ? undefined : t.seats[seat];
  return s && s.bot ? voiceGender(s.name) : undefined;
}

function pick(st: TalkState, t: TalkTable, persona: PersonaId, kind: TalkKind, ev: TalkEvent, rnd: () => number, self?: 'f' | 'm', target?: 'f' | 'm'): string | null {
  const all = poolFor(persona, kind, t.intensity ?? 'cookout', self, target, t.partnerships).filter((l) => condOk(LINE_META[l], ev, t));
  if (!all.length) return null;
  // an Ace got cut: the Ace lines are the point
  const ace = ev.ace ? all.filter((l) => LINE_META[l]?.cond === 'ace') : [];
  const base = ace.length && rnd() < 0.7 ? ace : all;
  const key = `${persona}:${kind}`;
  const used = ((st.used ??= {})[key] ??= []);
  let fresh = base.filter((l) => !used.includes(l) && l !== st.last && !st.recent.includes(l));
  if (!fresh.length) {
    // the pool is spent: forget it (keep the last line out so it never repeats back to back)
    st.used[key] = [];
    fresh = base.filter((l) => l !== st.last);
    if (!fresh.length) fresh = base.length > 1 ? base.filter((l) => l !== st.last) : [];
    if (!fresh.length) return null;
  }
  // own (non-COMMON) lines weigh double
  const own = PERSONAS[persona].lines[kind] ?? [];
  const weighted = fresh.flatMap((l) => (own.includes(l) ? [l, l] : [l]));
  const raw = weighted[Math.floor(rnd() * weighted.length)]!;
  st.used[key] = [...(st.used[key] ?? []), raw];
  return raw;
}

function say(st: TalkState, t: TalkTable, seat: number, kind: TalkKind, ev: TalkEvent, them: number | undefined, now: number, rnd: () => number, reveal = false): TalkLine | null {
  const persona = personaOf(t, seat);
  const name = t.seats[seat]?.name ?? '';
  const raw = pick(st, t, persona, kind, ev, rnd, voiceGender(name), botGender(t, them));
  if (!raw) return null;
  st.recent = [...st.recent, raw].slice(-TALK.recentMax);
  st.last = raw;
  st.lastAt = now;
  st.seatAt[seat] = now;
  let text = fill(raw, t, seat, ev, them);
  if (PERSONAS[persona].caps) text = text.toUpperCase();
  const line = lineIdOf(persona, kind, raw);
  return { seat, name: t.seats[seat]!.name, text, persona, ...(reveal ? { reveal: true } : {}), ...(line ? { line } : {}), ...(raw.includes('{bid}') && typeof ev.bid === 'number' ? { bid: ev.bid } : {}) };
}

const ready = (st: TalkState, seat: number, now: number, big: boolean) => now - (st.seatAt[seat] ?? -1e12) >= (big ? TALK.bigGapMs : TALK.seatGapMs);

/** React to a moment. Returns at most one line (or null), and updates the cooldown state. */
export function botTalk(st: TalkState, t: TalkTable, ev: TalkEvent, now: number, rnd: () => number): TalkLine | null {
  const bots = t.seats.map((s, i) => (s.bot ? i : -1)).filter((i) => i >= 0);
  if (!bots.length) return null;
  // no teams (Cutthroat): partner moments don't exist
  if (!t.partnerships && (ev.kind === 'partnerBlunder' || ev.kind === 'hypePartner')) return null;
  const big = BIG.includes(ev.kind);
  const actor = ev.seat;
  const side = ev.side ?? (actor !== undefined ? sideOfSeat(t, actor) : undefined);
  const onSide = (s: number) => side !== undefined && sideOfSeat(t, s) === side;
  const otherThem = (speaker: number) => ev.them ?? (actor !== undefined && sideOfSeat(t, actor) !== sideOfSeat(t, speaker) ? actor : t.seats.findIndex((_, i) => side !== undefined && !onSide(i) && i !== speaker));
  // a bot that runs the board always gets its line in (it's the centrepiece of the Run it! zoom)
  const claim = ev.kind === 'runIt' && ev.seat !== undefined && !!t.seats[ev.seat]?.bot && personaOf(t, ev.seat) !== 'hustler';
  if (claim) {
    const line = say(st, t, ev.seat!, 'runIt', ev, otherThem(ev.seat!), now, rnd);
    if (line) return line;
  }
  if (now - st.lastAt < (big ? TALK.bigGapMs : TALK.globalGapMs)) return null;

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
  if (kind === 'duck' || kind === 'roastBid' || kind === 'bidTooHigh' || kind === 'nilBid' || kind === 'blindNil' || kind === 'loudLoser') cands = bots.filter((b) => !onSide(b) && b !== ev.them);
  else if (kind === 'slow' || kind === 'rematch' || kind === 'prePlay') cands = bots.filter((b) => b !== ev.them);
  else if (kind === 'badHand') cands = actor !== undefined && t.seats[actor]?.bot ? [actor] : [];
  else if (kind === 'partnerBlunder') {
    // the blunderer's partner (a bot) groans at them; sometimes the other side laughs instead
    const p = t.partnerships && actor !== undefined ? (actor + 2) % t.seats.length : -1;
    cands = p >= 0 && t.seats[p]?.bot ? [p] : [];
    const others = bots.filter((b) => !onSide(b));
    if (others.length && (!cands.length || rnd() > 0.75)) { kind = 'roast'; cands = others; }
  }
  else {
    // 'runIt' lines are first person ('the rest are mine'): only the bot that ran it says them; otherwise the other side answers
    cands = actor !== undefined && t.seats[actor]?.bot && onSide(actor) ? [actor] : kind === 'runIt' ? [] : bots.filter(onSide);
    const mirror = MIRROR[kind];
    const others = bots.filter((b) => !onSide(b));
    if (mirror && others.length && (!cands.length || rnd() > 0.7)) { kind = mirror; cands = others; }
  }
  cands = cands.filter((c) => ready(st, c, now, big) && (personaOf(t, c) !== 'silent' || SILENT_KINDS.includes(kind)));
  if (!cands.length) return null;
  const seat = cands[Math.floor(rnd() * cands.length)]!;
  if (rnd() >= (TALK.chance[kind] ?? 0.3) * freqOf(st, t, seat)) return null;
  const them = kind === 'slow' || kind === 'partnerBlunder' ? ev.them ?? actor : otherThem(seat);
  // a set can come back as a petty one-liner
  if (kind === 'setThem' && rnd() < 0.15) kind = 'roast';
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

/**
 * A bot seat's play skill for this game: the table setting (Mixed rolls per seat, seeded by the game), then the
 * persona's bias (Hustler never below Pro; Lil Cuz wobbles a level up or down per game). Stable across refresh.
 */
export function botSkillFor(setting: Parameters<typeof seatSkill>[0], gameSeed: string, seat: number, name: string): BotSkill {
  const p = PERSONAS[personaForName(name)];
  let sk = seatSkill(setting, gameSeed, seat, p.skillFloor);
  if (p.skillJitter) {
    let h = 2166136261;
    for (const ch of `${gameSeed}:cuz:${seat}`) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 16777619); }
    const d = ((h >>> 0) % 3) - 1;
    sk = BOT_SKILLS[Math.max(0, Math.min(BOT_SKILLS.length - 1, BOT_SKILLS.indexOf(sk) + d))]!;
  }
  return sk;
}
