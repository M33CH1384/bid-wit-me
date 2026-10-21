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
 */
import type { Action, GameState } from '@spades/rules';
import { type RevTributeEvent, type TalkLine, type TalkTable, REV_TRIBUTE, botTalk, collectionBanter, leanBid, leanNil, momentsFor, newRevTributeState, newTalkState, personaForName, prePlayLine, revLineIdForText, revTributeCommit, revTributeDetect } from '@spades/bots';
import { getActiveDeck } from './decks';
import { talkPrefs } from './talkPrefs';

export const offlineTalk = {
  table: null as TalkTable | null,
  state: newTalkState(),
  sink: null as ((l: TalkLine) => void) | null,
  /** Revolutionaries tribute caps for the current game (reset by newGame) */
  rev: newRevTributeState(),
  /** true at the Barbershop story table — set by Table.tsx with the table */
  revShop: false,
  newGame() { this.state = newTalkState(); this.rev = newRevTributeState(); },
  on(): boolean { return !!this.table && !!this.sink && talkPrefs.get().botTalk; },
  emit(l: TalkLine | null) { if (l) this.sink?.(l); return !!l; },
  step(before: GameState, action: Action, after: GameState) {
    if (!this.on()) return;
    const rev = getActiveDeck() === 'revolutionaries' ? revTributeDetect(this.rev, before, action, after, Math.random) : null;
    if (rev?.kind === 'malcolmCut') { this.revSpeak(rev, after); return; }
    let spoke = false;
    for (const ev of momentsFor(before, action, after)) spoke = this.emit(botTalk(this.state, this.table!, ev, performance.now(), Math.random)) || spoke;
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
  banter(after: GameState): TalkLine[] {
    if (!this.table || !talkPrefs.get().botTalk) return [];
    return collectionBanter(this.state, this.table, after, performance.now(), Math.random);
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
