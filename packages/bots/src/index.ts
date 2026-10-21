import { type Action, type GameState, type PlayerView, type Rng, type TableRules, applyAction, createRng, newGame, pendingTurn, viewFor } from '@spades/rules';
import { type BotLevel, chooseBid, wantsBlindNil } from './bidding';
import type { PartnerHint } from './partnerTalk';
import { chooseExchange, choosePlay } from './play';

export * from './bidding';
export { choosePlay, chooseExchange, isPremium, NOVICE_BLUNDER_RATE } from './play';
export { voidsOf } from './knowledge';

/**
 * Picks the next action for a bot seat from that seat's view only.
 * Returns null if it isn't this seat's turn.
 */
export function chooseBotAction(v: PlayerView, level: BotLevel = 'pro', rng: Rng = createRng(`${v.seat}:${v.handNo}:${v.tricks.length}`), hint?: PartnerHint | null): Action | null {
  if (v.turn !== v.seat) return null;
  switch (v.phase) {
    case 'bidding':
      if (v.hand === null) {
        if (wantsBlindNil(v, level)) return { type: 'bid', seat: v.seat, bid: 'blindNil' };
        return { type: 'reveal', seat: v.seat };
      }
      return { type: 'bid', seat: v.seat, bid: chooseBid(v, level, rng, hint) };
    case 'exchange':
      return { type: 'exchange', seat: v.seat, cards: chooseExchange(v) };
    case 'playing':
      // guaranteed the rest from cards this seat can see: run it most of the time, for the show
      if (v.canRunIt && rng.int(100) < 65) return { type: 'runIt', seat: v.seat };
      return { type: 'play', seat: v.seat, card: choosePlay(v, level, rng) };
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
  const levels = opts.levels ?? Array(rules.playerCount).fill('pro');
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
export * from './voices';
export { PACK, STYLE } from './pack';
export { PACK2, COMMON_EXTRA } from './pack2';
export * from './pronounce';
export * from './story';
export * from './storyScripts';
export * from './storySecrets';
export * from './storyTape';
export * from './storyKingDouble';
export * from './storyVoice';
export * from './storyBadges';
export * from './storyRail';
export * from './takes';
export * from './partnerTalk';
export * from './catalog';
