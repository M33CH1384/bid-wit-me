/**
 * Offline trash talk: the same engine as the server, driven by the local game (useGame reports each step).
 * Table.tsx sets the table (names, team names) and the sink that posts lines to the chat.
 *
 * Revolutionaries tributes (revTributes.ts in @spades/bots) ride this driver:
 * while the history deck is the active deck, court plays and the Malcolm cut
 * are detected here, ahead of the generic moment engine — the signature
 * pre-empts the step's line, a regular tribute only speaks when the engine
 * didn't. Table.tsx says whether this is the Barbershop story table (revShop),
 * where Coleman and June carry the lines as story characters; everywhere else
 * the bot who threw the card speaks, and a human's card gets a bot witness.
 *
 * Speech density (2026-10-22) also lives here, on top of the engine's
 * per-class profiles (TALK_PROFILES in @spades/bots):
 * - MIX HIERARCHY: Table.tsx reports higher-priority speech (scripted scene
 *   beats, signature sets, tributes, rail, consultation) through
 *   noteHighPriority/noteConsult, stamping voiceBusyUntil. A generic line
 *   that would REPLACE such a line (start before busyUntil − 3 s, the
 *   engine's tail-overlap window) is dropped, never queued — density comes
 *   from trigger frequency, not a backlog commenting on old tricks.
 * - ANSWER CHAINS: a delivered generic line may be answered a beat after
 *   its clip ends — an opponent's roast (65%) or the partner's trickPop
 *   co-sign (35%) — rolled per class (answerP, halving per link, maxChain).
 *   Answers are the lowest-priority speech in the room and the first dropped.
 * - CONSULTATION RIGHT OF WAY: while a consultation line is playing (or
 *   within 600 ms after), generic bid-event talk is dropped, not queued.
 * - DECISION PROTECTION: no generic line with a clip over 2.5 s starts
 *   while the human has a pending bid/play decision (Table.tsx maintains
 *   humanDeciding). Reactions to the human's own just-completed action are
 *   exempt; the only other in-think speech is the murmur.
 * - MURMURS: on the human's clock, after a class-defined silence, one
 *   short (≤ 2 s) trickPop pop from a bot seat; at most twice per turn.
 * - ANTI-REPEAT: the same text from two different speakers inside 60 s is
 *   suppressed (cross-speaker dedupe), on top of the engine's shuffle-bag.
 */
import type { Action, GameState } from '@spades/rules';
import { type RevTributeEvent, type TalkLine, type TalkTable, REV_TRIBUTE, botTalk, collectionBanter, leanBid, leanNil, momentsFor, newRevTributeState, newTalkState, personaForName, personaOf, prePlayLine, profileOf, revLineIdForText, revTributeCommit, revTributeDetect, sideOfSeat } from '@spades/bots';
import { getActiveDeck } from './decks';
import { spokenClipDurationMs, talkPrefs } from './talkPrefs';

/** why/how a generic line is being delivered — drives the gates + chain depth */
interface EmitMeta {
  /** the line reacts to the human's own just-completed action (decision-gate exempt) */
  humanReact?: boolean;
  /** answer-chain depth of THIS line (0 = an original line) */
  depth?: number;
  /** the line is a thinking-time murmur */
  murmur?: boolean;
  /** the caller already applied the decision gate against the real clip duration */
  checked?: boolean;
}

export const offlineTalk = {
  table: null as TalkTable | null,
  state: newTalkState(),
  sink: null as ((l: TalkLine) => void) | null,
  /** Revolutionaries tribute caps for the current game (reset by newGame) */
  rev: newRevTributeState(),
  /** true at the Barbershop story table — set by Table.tsx with the table */
  revShop: false,
  /** a higher-priority line (scripted / tribute / rail / consultation…) is
   * playing or scheduled until this performance.now() timestamp */
  voiceBusyUntil: 0,
  /** a partner-consultation line is playing until this timestamp (the
   * consultation build stamps it via noteConsult; bidding-phase generic
   * talk drops inside its window + 600 ms). −∞ until the first stamp:
   * performance.now() near page load is small, and 0 would read as a
   * live window for the first 600 ms of the page. */
  consultBusyUntil: -1e12,
  /** the human has a pending bid/play decision right now (Table.tsx) */
  humanDeciding: false,
  /** last time ANY layer's speech started (or is scheduled to start) —
   * the murmur timer's silence reference */
  lastSpeechAt: -1e12,
  /** delivered generic texts, for the 60 s cross-speaker dedupe */
  recentTexts: [] as { text: string; seat: number; at: number }[],
  /** spokenClipDurationMs results by line id/text (the decision gate's
   * synchronous view; −1 = known text-only, −2 = lookup in flight) */
  durCache: new Map<string, number>(),
  answerTimers: [] as number[],
  newGame() {
    this.state = newTalkState();
    this.rev = newRevTributeState();
    this.voiceBusyUntil = 0;
    this.consultBusyUntil = -1e12;
    this.humanDeciding = false;
    this.lastSpeechAt = -1e12;
    this.recentTexts = [];
    this.durCache.clear();
    for (const t of this.answerTimers) window.clearTimeout(t);
    this.answerTimers = [];
  },
  on(): boolean { return !!this.table && !!this.sink && talkPrefs.get().botTalk; },
  /** a higher-priority line starts at `startAt` and runs `durationMs` —
   * generic lines may only tail-overlap its last 3 s, never replace it */
  noteHighPriority(startAt: number, durationMs: number) {
    this.voiceBusyUntil = Math.max(this.voiceBusyUntil, startAt + durationMs);
    this.noteSpeechAt(startAt);
  },
  /** a consultation line starts now and runs `durationMs`: it is
   * higher-priority speech AND it owns the bidding window outright */
  noteConsult(durationMs: number) {
    const now = performance.now();
    this.consultBusyUntil = Math.max(this.consultBusyUntil, now + durationMs);
    this.noteHighPriority(now, durationMs);
  },
  /** speech (any layer) started — or is scheduled to start — at `at` */
  noteSpeechAt(at: number) { this.lastSpeechAt = Math.max(this.lastSpeechAt, at); },
  /** record a delivered line for the dedupe window + the silence clock */
  noteDelivered(l: TalkLine) {
    const now = performance.now();
    this.noteSpeechAt(now);
    this.recentTexts = [...this.recentTexts.filter((r) => now - r.at < 60_000), { text: l.text, seat: l.seat, at: now }].slice(-24);
  },
  durKey(l: TalkLine): string { return `${l.line ?? l.text}|${l.bid ?? ''}`; },
  /** the gate's synchronous view of a line's clip length: ms, 0 for a
   * known text-only line, undefined while the lookup is still out */
  cachedDuration(l: TalkLine): number | undefined {
    const v = this.durCache.get(this.durKey(l));
    return v === undefined || v === -2 ? undefined : (v < 0 ? 0 : v);
  },
  primeDuration(l: TalkLine) {
    const k = this.durKey(l);
    if (this.durCache.has(k)) return;
    this.durCache.set(k, -2); // lookup in flight
    void spokenClipDurationMs(l.name, l.text, l.persona, l.line, l.bid)
      .then((d) => this.durCache.set(k, d ?? -1))
      .catch(() => this.durCache.set(k, -1));
  },
  /** hand a line to the sink and run the delivery-side bookkeeping */
  deliverLine(l: TalkLine, meta: EmitMeta): boolean {
    if (!this.sink) return false;
    this.sink(l);
    this.noteDelivered(l);
    this.maybeAnswer(l, meta);
    return true;
  },
  emit(l: TalkLine | null, meta: EmitMeta = {}) {
    if (!l) return false;
    const now = performance.now();
    // mix hierarchy: never replace a higher-priority line (tail-overlap only)
    if (now < this.voiceBusyUntil - 3000) return false;
    // cross-speaker dedupe: the same sentence from two mouths inside a minute reads as a glitch
    if (this.recentTexts.some((r) => r.text === l.text && r.seat !== l.seat && now - r.at < 60_000)) return false;
    // decision protection: nothing long starts on the human's clock
    if (this.humanDeciding && !meta.humanReact && !meta.checked) {
      const d = this.cachedDuration(l);
      if (d !== undefined && d > 2500) return false;
      if (d === undefined) this.primeDuration(l);
    }
    return this.deliverLine(l, meta);
  },
  /** After a generic line lands, the table may answer it (call-and-response). */
  maybeAnswer(l: TalkLine, meta: EmitMeta) {
    const t = this.table;
    if (!t || !this.sink) return;
    const prof = profileOf(t);
    const depth = meta.depth ?? 0;
    if (prof.maxChain <= 0 || depth >= prof.maxChain || prof.answerP <= 0) return;
    if (Math.random() >= prof.answerP * Math.pow(0.5, depth)) return;
    void (async () => {
      let d: number | null = null;
      try { d = await spokenClipDurationMs(l.name, l.text, l.persona, l.line, l.bid); } catch { d = null; }
      if (!this.on()) return;
      // the answer lands in the beat AFTER the first voice finishes
      const wait = (d ?? 1400) + 300 + Math.random() * 400;
      const timer = window.setTimeout(() => { void this.fireAnswer(l, depth, meta); }, wait);
      this.answerTimers.push(timer);
    })();
  },
  async fireAnswer(origin: TalkLine, depth: number, meta: EmitMeta) {
    if (!this.on()) return;
    const t = this.table!;
    // answers never start while a scripted beat is playing or lands within 500 ms
    if (performance.now() < this.voiceBusyUntil + 500) return;
    const originSide = sideOfSeat(t, origin.seat);
    let line: TalkLine | null = null;
    // who answers: the other side ~65% (a roast back), the partner ~35% (a co-sign pop)
    if (t.partnerships && Math.random() < 0.65) {
      line = botTalk(this.state, t, { kind: 'roast', side: 1 - originSide, them: origin.seat }, performance.now(), Math.random);
    }
    if (!line) {
      line = botTalk(this.state, t, { kind: 'trickPop', side: originSide, answerSide: originSide, excludeSeat: origin.seat }, performance.now(), Math.random);
    }
    if (!line) return; // cooldown/chance said no — the chain dies, never forced
    let d: number | null = null;
    try { d = await spokenClipDurationMs(line.name, line.text, line.persona, line.line, line.bid); } catch { d = null; }
    if (!this.on()) return;
    // decision protection with the real duration: in-think speech is the
    // murmur's job; a reaction-chain answer may be short, never long
    if (this.humanDeciding && !meta.humanReact) return;
    if (this.humanDeciding && d !== null && d > 2500) return;
    if (performance.now() < this.voiceBusyUntil - 3000) return;
    this.deliverLine(line, { depth: depth + 1, humanReact: meta.humanReact });
  },
  /**
   * A thinking-time murmur: one SHORT clip (≤ 2 s) from an eligible bot
   * seat while the human deliberates. Re-picks once on a long first draw,
   * then drops — a murmur that has to shout over the gate isn't one.
   * Returns the seat that murmured, or false when none did.
   */
  async murmur(excludeSeat?: number): Promise<number | false> {
    if (!this.on()) return false;
    const t = this.table!;
    if (profileOf(t).murmurMs <= 0) return false;
    const seats = t.seats.map((s, i) => (s.bot ? i : -1)).filter((i) => i >= 0 && i !== excludeSeat && personaOf(t, i) !== 'silent');
    for (let i = seats.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [seats[i], seats[j]] = [seats[j]!, seats[i]!]; }
    for (const seat of seats.slice(0, 2)) {
      const line = botTalk(this.state, t, { kind: 'trickPop', seat, murmur: true }, performance.now(), Math.random);
      if (!line) continue;
      let d: number | null = null;
      try { d = await spokenClipDurationMs(line.name, line.text, line.persona, line.line, line.bid); } catch { d = null; }
      if (d !== null && d > 2000) continue;
      if (!this.on()) return false;
      if (performance.now() < this.voiceBusyUntil - 3000) return false;
      return this.deliverLine(line, { murmur: true, checked: true }) ? seat : false;
    }
    return false;
  },
  step(before: GameState, action: Action, after: GameState) {
    if (!this.on()) return;
    const rev = getActiveDeck() === 'revolutionaries' ? revTributeDetect(this.rev, before, action, after, Math.random) : null;
    if (rev?.kind === 'malcolmCut') { this.revSpeak(rev, after); return; }
    // consultation right of way: generic bid talk inside its window drops
    const bidSuppressed = action.type === 'bid' && performance.now() < this.consultBusyUntil + 600;
    const humanSeat = this.table!.seats.findIndex((s) => !s.bot);
    const meta: EmitMeta = { humanReact: 'seat' in action && action.seat === humanSeat };
    let spoke = false;
    if (!bidSuppressed) {
      for (const ev of momentsFor(before, action, after)) spoke = this.emit(botTalk(this.state, this.table!, ev, performance.now(), Math.random), meta) || spoke;
    }
    if (!spoke && rev) this.revSpeak(rev, after);
  },
  /** Deliver a tribute: pick the speaker, commit the caps, stamp the talk
   * engine's cooldowns (so the next generic line keeps its distance), and
   * hand the line to the same sink every other line takes. */
  revSpeak(ev: RevTributeEvent, after: GameState) {
    const t = this.table!;
    const seats = t.seats;
    const botAt = (s: number | undefined) => (s !== undefined && seats[s]?.bot ? s : undefined);
    const named = (n: string) => { const i = seats.findIndex((s) => s.name === n && s.bot); return i >= 0 ? i : undefined; };
    let seat: number | undefined;
    let text = ev.text;
    if (this.revShop) {
      if (ev.kind === 'tribute' && ev.juneText && Math.random() < REV_TRIBUTE.juneShare) {
        const j = named('June');
        if (j !== undefined) { seat = j; text = ev.juneText; }
      }
      seat ??= named('Mr. Coleman') ?? botAt(ev.cardSeat);
    }
    if (seat === undefined) {
      const firstBot = seats.findIndex((s) => s.bot);
      seat = botAt(ev.cardSeat)
        ?? (t.partnerships ? botAt((ev.cardSeat + 2) % seats.length) : undefined)
        ?? botAt(ev.cutterSeat)
        ?? (firstBot >= 0 ? firstBot : undefined);
    }
    if (seat === undefined) return;
    const name = seats[seat]?.name ?? '';
    const now = performance.now();
    revTributeCommit(this.rev, ev, after.handNo, after.tricks.length - 1);
    this.state.lastAt = now;
    this.state.seatAt[seat] = now;
    this.noteSpeechAt(now);
    this.sink?.({
      seat, name, text, persona: personaForName(name),
      // At a story table the line resolves through the speaker's cast sprite
      // keyed by text (one-timbre rule) — no catalog id. Everywhere else the
      // rev id resolves the recorded clip in the speaker's own persona sprite.
      ...(this.revShop ? {} : { line: revLineIdForText(text) }),
    });
  },
  moment(ev: Parameters<typeof botTalk>[2]) { if (this.on()) this.emit(botTalk(this.state, this.table!, ev, performance.now(), Math.random)); },
  /** collection-window banter lines about the hand that just ended; the caller owns delivery timing.
   * Gated on the same Bot-trash-talk pref as the engine (the old pack draw ignored it). */
  banter(after: GameState, maxLines = 2): TalkLine[] {
    if (!this.table || !talkPrefs.get().botTalk) return [];
    const lines = collectionBanter(this.state, this.table, after, performance.now(), Math.random, maxLines);
    // the cross-speaker dedupe covers banter too — it reaches the table by another road
    const now = performance.now();
    return lines.filter((l) => !this.recentTexts.some((r) => r.text === l.text && r.seat !== l.seat && now - r.at < 60_000));
  },
  /** before a bot plays: maybe a line (never sees the card); true = give it a beat */
  prePlay(seat: number): boolean { return this.on() && this.emit(prePlayLine(this.state, this.table!, seat, performance.now(), Math.random)); },
  lean(action: Action): Action {
    const t = this.table;
    if (!t || action.type !== 'bid') return action;
    const name = t.seats[action.seat]?.name ?? '';
    if (typeof action.bid === 'number') return { ...action, bid: leanBid(action.bid, name, this.state.revealed.includes(action.seat), Math.random) };
    if (action.bid === 'nil' && leanNil(name, Math.random)) return { ...action, bid: 1 };
    return action;
  },
};
