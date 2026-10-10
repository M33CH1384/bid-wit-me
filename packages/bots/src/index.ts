import { type Action, type GameState, type PlayerView, type Rng, type TableRules, applyAction, createRng, newGame, pendingTurn, viewFor } from '@spades/rules';
import { type BotLevel, chooseBid, wantsBlindNil } from './bidding';
import { chooseExchange, choosePlay } from './play';

export * from './bidding';
export { choosePlay, chooseExchange } from './play';

/**
 * Picks the next action for a bot seat from that seat's view only.
 * Returns null if it isn't this seat's turn.
 */
export function chooseBotAction(v: PlayerView, level: BotLevel = 'normal', rng: Rng = createRng(`${v.seat}:${v.handNo}:${v.tricks.length}`)): Action | null {
  if (v.turn !== v.seat) return null;
  switch (v.phase) {
    case 'bidding':
      if (v.hand === null) {
        if (wantsBlindNil(v, level)) return { type: 'bid', seat: v.seat, bid: 'blindNil' };
        return { type: 'reveal', seat: v.seat };
      }
      return { type: 'bid', seat: v.seat, bid: chooseBid(v, level, rng) };
    case 'exchange':
      return { type: 'exchange', seat: v.seat, cards: chooseExchange(v) };
    case 'playing':
      return { type: 'play', seat: v.seat, card: choosePlay(v, level) };
    default:
      return null;
  }
}

export interface SimOptions {
  levels?: BotLevel[];
  maxHands?: number;
  onAction?: (st: GameState, action: Action) => void;
}

/** Runs a full bot-vs-bot game. Throws if the engine rejects any bot move or the game doesn't finish. */
export function simulateGame(rules: TableRules, seed: string, opts: SimOptions = {}): GameState {
  const levels = opts.levels ?? Array(rules.playerCount).fill('normal');
  const maxHands = opts.maxHands ?? 200;
  const rng = createRng(`${seed}:bots`);
  let st = newGame(rules, seed);
  let guard = 0;
  while (st.phase !== 'gameOver') {
    if (++guard > maxHands * 200) throw new Error('simulation did not terminate');
    if (st.phase === 'handOver') {
      if (st.handNo >= maxHands) throw new Error(`game exceeded ${maxHands} hands`);
      st = applyAction(st, { type: 'nextHand' });
      continue;
    }
    const t = pendingTurn(st)!;
    const action = chooseBotAction(viewFor(st, t.seat), levels[t.seat]!, rng)!;
    opts.onAction?.(st, action);
    st = applyAction(st, action);
  }
  return st;
}
export * from './names';
export * from './talk';
export * from './moments';
