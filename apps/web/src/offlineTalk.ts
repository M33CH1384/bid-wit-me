/**
 * Offline trash talk: the same engine as the server, driven by the local game (useGame reports each step).
 * Table.tsx sets the table (names, team names) and the sink that posts lines to the chat.
 */
import type { Action, GameState } from '@spades/rules';
import { type TalkLine, type TalkTable, botTalk, collectionBanter, leanBid, leanNil, momentsFor, newTalkState, prePlayLine } from '@spades/bots';
import { talkPrefs } from './talkPrefs';

export const offlineTalk = {
  table: null as TalkTable | null,
  state: newTalkState(),
  sink: null as ((l: TalkLine) => void) | null,
  newGame() { this.state = newTalkState(); },
  on(): boolean { return !!this.table && !!this.sink && talkPrefs.get().botTalk; },
  emit(l: TalkLine | null) { if (l) this.sink?.(l); return !!l; },
  step(before: GameState, action: Action, after: GameState) {
    if (!this.on()) return;
    for (const ev of momentsFor(before, action, after)) this.emit(botTalk(this.state, this.table!, ev, performance.now(), Math.random));
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
