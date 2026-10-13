import { describe, expect, it } from 'vitest';
import type { SeatInfo } from '@spades/protocol';
import { loserCaption, victoryHeadline, victoryIdentity } from '../src/online/victory';

describe('game-over labels', () => {
  const human: SeatInfo = { kind: 'human', playerId: 'p1', name: 'Demetrius', connected: true, media: { cam: false, mic: false } };
  const bot: SeatInfo = { kind: 'bot', name: 'Peaches', level: 'pro' };
  const replaced: SeatInfo = { kind: 'bot', name: 'Peaches', level: 'pro', was: 'Slow' };

  it('names humans, including a human a bot replaced, and only tags a real bot', () => {
    expect(victoryIdentity(human, 'You')).toEqual({ name: 'Demetrius', bot: false });
    expect(victoryIdentity(replaced, 'Peaches')).toEqual({ name: 'Slow', bot: false });
    expect(victoryIdentity(bot, 'Peaches')).toEqual({ name: 'Peaches', bot: true });
    expect(victoryIdentity({ kind: 'empty' }, 'Seat 2')).toEqual({ name: 'Seat 2', bot: false });
  });

  it('gives the losing side a quiet caption instead of an empty block', () => {
    expect(loserCaption(0)).toBeNull();
    expect(loserCaption(2)).toBe('Lost');
  });

  it('uses the human name in the headline unless the team has its own name', () => {
    const winners = [{ name: 'Zuri', isMe: false }, { name: 'Terrell', isMe: false }];
    expect(victoryHeadline(true, 'Arjun & Terrell win', 'Arjun & Terrell win', winners)).toBe('Zuri & Terrell win');
    expect(victoryHeadline(true, 'Shot Callers win', 'Arjun & Terrell win', winners)).toBe('Shot Callers win');
    expect(victoryHeadline(false, 'Peaches wins', 'Peaches wins', [{ name: 'Demetrius', isMe: true }])).toBe('You win');
  });
});