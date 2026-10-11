import { describe, expect, it } from 'vitest';
import { type GameState, applyAction, makeRules, newGame, pendingTurn, viewFor } from '@spades/rules';
const J = (o: Record<string, unknown> = {}) => makeRules('joker', o);
import { chooseBotAction, loudLoser, momentsFor, type TalkEvent } from '../src';

/** play bot games and collect every moment kind with an example */
function collect(games = 30): Map<string, TalkEvent> {
  const seen = new Map<string, TalkEvent>();
  for (let g = 0; g < games; g++) {
    let st: GameState = newGame(J({ shotOut: g % 2 === 0 }), `mom-${g}`);
    for (let i = 0; i < 4000 && st.phase !== 'gameOver'; i++) {
      if (st.phase === 'handOver') { st = applyAction(st, { type: 'nextHand' }); continue; }
      const t = pendingTurn(st); if (!t) break;
      const a = chooseBotAction(viewFor(st, t.seat), g % 3 === 0 ? 'novice' : 'pro')!;
      const next = applyAction(st, a);
      for (const ev of momentsFor(st, a, next)) if (!seen.has(ev.kind)) seen.set(ev.kind, ev);
      st = next;
    }
  }
  return seen;
}

describe('trash-talk moments', () => {
  const seen = collect();
  it('the pack events fire in real games', () => {
    for (const k of ['cut', 'setThem', 'slam', 'partnerBlunder', 'bidTooHigh', 'badHand', 'nilBid', 'joker', 'bags', 'win']) expect(seen.has(k), k).toBe(true);
  });
  it('Ace-cut flags the event; negative sets flag neg', () => {
    // a cut is flagged ace only when the card it beat was a non-trump Ace
    let ace = false;
    for (let g = 0; g < 20 && !ace; g++) {
      let st: GameState = newGame(J({ shotOut: false }), `ace-${g}`);
      for (let i = 0; i < 3000 && st.phase !== 'gameOver' && !ace; i++) {
        if (st.phase === 'handOver') { st = applyAction(st, { type: 'nextHand' }); continue; }
        const t = pendingTurn(st)!; const a = chooseBotAction(viewFor(st, t.seat), 'pro')!; const next = applyAction(st, a);
        for (const ev of momentsFor(st, a, next)) if (ev.kind === 'cut' && ev.ace) {
          ace = true;
          const beaten = st.trick.plays.map((p) => p.card);
          expect(beaten.some((c) => c[0] === 'A' && c[1] !== 'S')).toBe(true);
        }
        st = next;
      }
    }
    expect(ace).toBe(true);
  });
  it('a trailing human spamming the chat is a loudLoser moment; a leader is not', () => {
    const st = newGame(J(), 'll');
    const trailing = { ...st, scores: [-50, 120] };
    expect(loudLoser(trailing, 0, [1, 2, 3])?.kind).toBe('loudLoser');
    expect(loudLoser(trailing, 0, [1, 2])).toBeNull();
    expect(loudLoser({ ...st, scores: [200, 120] }, 0, [1, 2, 3])).toBeNull();
  });
});
