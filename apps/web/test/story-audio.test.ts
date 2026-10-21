import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { STORY_STOPS } from '@spades/bots';
import { STORY_STOP_AUDIO, storyAudioForStop } from '../src/spatial';
import { STORY_MOTIF_HZ, STORY_TRACK_FILE, TRACKS, sound } from '../src/audio';

/**
 * Story Mode audio (Story Audio Pass, 2026-10-21): the game's original score wired per stop,
 * plus the upgraded venue beds. The scene UI reaches all of it through ONE call —
 * sound.setStoryStop(stopId) — and normal games never hear the score: the story tracks are
 * storyOnly, and the mood only exists while a story stop is active.
 */
describe('story score wiring', () => {
  it('every story stop has an audio entry, and every entry names a real stop', () => {
    expect(Object.keys(STORY_STOP_AUDIO).sort()).toEqual(STORY_STOPS.map((s) => s.id).sort());
    for (const s of STORY_STOPS) expect(storyAudioForStop(s.id), s.id).toBeTruthy();
  });

  it('danger stops loop the danger bed, the King gets his arrangement, the rest ride the theme', () => {
    for (const id of ['corner', 'high-rise', 'the-pjs']) expect(STORY_STOP_AUDIO[id]!.mood, id).toBe('danger');
    expect(STORY_STOP_AUDIO['king']!.mood).toBe('king');
    for (const id of ['barbershop', 'rec-center', 'cookout', 'legends']) {
      expect(STORY_STOP_AUDIO[id]!.mood, id).toBe('theme');
    }
  });

  it('the slow stops carry the sparse theme — the score can go quiet, not just big', () => {
    for (const id of ['porch', 'church-basement', 'rooftop']) expect(STORY_STOP_AUDIO[id]!.mood, id).toBe('sparse');
    expect(STORY_TRACK_FILE.sparse).toBe('story-theme-sparse');
  });

  it('only the Rec Center overrides its (silent-by-design) venue bed, with the gym bed', () => {
    expect(STORY_STOP_AUDIO['rec-center']!.bed).toBe('rec');
    for (const [id, a] of Object.entries(STORY_STOP_AUDIO)) if (id !== 'rec-center') expect(a.bed, id).toBeUndefined();
  });

  it('every mood resolves to an original score track that exists in the playlist', () => {
    const files = new Map(TRACKS.map((t) => [t.file, t]));
    for (const mood of ['theme', 'sparse', 'danger', 'king'] as const) {
      const t = files.get(STORY_TRACK_FILE[mood]);
      expect(t, mood).toBeTruthy();
      expect(t!.license, mood).toBe('Original');
      expect(t!.storyOnly, mood).toBe(true);
      expect(t!.credit, mood).toBeUndefined();
    }
  });

  it('the signature motif is the four notes that open the theme (D–F–A–C)', () => {
    expect(STORY_MOTIF_HZ).toEqual([587.33, 698.46, 880, 1046.5]);
  });

  it('setStoryStop drives the engine mood and clears on null / unknown stops', () => {
    sound.setStoryStop('king');
    expect(sound.storyMood).toBe('king');
    sound.setStoryStop('corner');
    expect(sound.storyMood).toBe('danger');
    sound.setStoryStop('porch');
    expect(sound.storyMood).toBe('sparse');
    sound.setStoryStop('cookout');
    expect(sound.storyMood).toBe('theme');
    sound.setStoryStop('no-such-stop');
    expect(sound.storyMood).toBeNull();
    sound.setStoryStop(null);
    expect(sound.storyMood).toBeNull();
  });
});

describe('upgraded venue beds (buildBed source pins)', () => {
  const src = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
  it('the gym bed exists for the Rec Center override', () => {
    expect(src).toContain("case 'rec':");
  });
  it('story-venue life layers are scheduled (hymn through the wall, scissors, screen door, gusts, car-stereo pass)', () => {
    for (const marker of ['hymn through the wall', 'scissors between cuts', 'screen door to the', 'wind chime two roofs over', 'a car rolls past slow with the bass up', 'money-quiet', 'the yard is alive']) {
      expect(src, marker).toContain(marker);
    }
  });
  it('the story API surface exists (setStoryStop + storySting)', () => {
    expect(src).toContain('setStoryStop(stopId: string | null)');
    expect(src).toContain("storySting(kind: 'scene' | 'clear' | 'unlock' = 'scene')");
  });
});
