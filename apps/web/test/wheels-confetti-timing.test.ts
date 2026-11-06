/**
 * @vitest-environment happy-dom
 *
 * WHEELS CONFETTI TIMING (owner, 2026-11-05: "The confetti shouldn't fall
 * when teams bid 10 (wheels) it should happen when they actually earn
 * ten"). The falling confetti is the photoreal goldrain overlay ("Gold
 * rain: tumbling foil confetti"). It used to ride the fx 'wheels' event,
 * which fires at BID DECLARATION; it now rides 'wheelsRain', emitted at
 * the moment the declaring side's books reach its contract. Everything
 * else about the declaration beat — the WHEELS! pop, the sound, the
 * shake — is untouched, and the results-surface VictoryConfetti is a
 * separate system, also untouched (source pins: wheels-confetti-source).
 */
import { describe, expect, it, vi } from 'vitest';
import { fx, type FxEvent } from '../src/fx';
import { photorealFor } from '../src/photoreal/host';
import { sound } from '../src/audio';

describe('the rain moved from the call to the earn', () => {
  it('the declaration event still flows to its listeners — but no overlay answers it', () => {
    const seen: FxEvent[] = [];
    const off = fx.on((e) => seen.push(e));
    fx.emit('wheels', { silent: true });
    off();
    expect(seen.map((e) => e.kind)).toEqual(['wheels']); // Hype's pop channel intact
    expect(photorealFor({ kind: 'wheels' })).toBeNull(); // ...and nothing falls for it anymore
  });

  it('wheelsRain reaches the gold rain and nothing else: no sound, no shake', () => {
    const play = vi.spyOn(sound, 'play').mockImplementation(() => undefined as never);
    const seen: FxEvent[] = [];
    const off = fx.on((e) => seen.push(e));
    const shakeBefore = fx.shake;
    fx.emit('wheelsRain', { silent: true });
    off();
    expect(seen.map((e) => e.kind)).toEqual(['wheelsRain']);
    expect(photorealFor({ kind: 'wheelsRain' })).toBe('goldrain'); // same visual idiom as before
    expect(play).not.toHaveBeenCalled(); // silent: the earn carries no cue of its own
    expect(fx.shake).toBe(shakeBefore); // no shake branch for the rain
    play.mockRestore();
  });
});
