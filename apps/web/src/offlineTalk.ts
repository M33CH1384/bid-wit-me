/**
 * Offline trash talk: the same engine as the server, driven by the local game (useGame reports each step).
 * Table.tsx sets the table (names, team names) and the sink that posts lines to the chat.
 */
import type { Action, GameState } from '@spades/rules';
import { type TalkLine, type TalkTable, botTalk, leanBid, leanNil, momentsFor, newTalkState, prePlayLine } from '@spades/bots';
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
  /** before a bot plays: maybe a line (never sees the card); true = give it a beat.
   * `spadesBroken` is the game's flag at this call, not a value cached from an earlier turn. */
  prePlay(seat: number, spadesBroken: boolean): boolean {
    if (!this.on() || !this.table) return false;
    this.table = { ...this.table, spadesBroken };
    return this.emit(prePlayLine(this.state, this.table, seat, performance.now(), Math.random));
  },
  lean(action: Action): Action {
    const t = this.table;
    if (!t || action.type !== 'bid') return action;
    const name = t.seats[action.seat]?.name ?? '';
    if (typeof action.bid === 'number') return { ...action, bid: leanBid(action.bid, name, this.state.revealed.includes(action.seat), Math.random) };
    if (action.bid === 'nil' && leanNil(name, Math.random)) return { ...action, bid: 1 };
    return action;
  },
};
