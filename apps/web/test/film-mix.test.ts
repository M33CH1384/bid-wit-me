import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { ROOM_STYLES, STORY_STOP_AUDIO } from '../src/spatial';
import {
  FILM_BLAST, FILM_NEUTRAL, FILM_SET_DIP, STORY_TRACK_FILE, TRACKS, filmTargets, generalPool, sound,
} from '../src/audio';

/**
 * Sound sample (2026-10-23): the film-mix pilot. EXACTLY two surfaces change —
 * the menus (one original soul theme instead of the pool draw) and the Porch
 * (four-layer film mix: room tone / close human sounds / outside world / score,
 * with bidding thinning the score, a set dropping it a register, and the nuke /
 * mega ducking everything). Everything else keeps its sound byte-for-byte; the
 * pins below hold the other eleven stops and all twelve venues to their
 * pre-sample identities verbatim.
 */
describe('the sample touches exactly two surfaces', () => {
  it('every story stop keeps its pre-sample identity except the Porch', () => {
    expect(STORY_STOP_AUDIO).toEqual({
      'porch': { mood: 'porch', bed: 'porch' },
      'barbershop': { mood: 'theme' },
      'rec-center': { mood: 'theme', bed: 'rec' },
      'cookout': { mood: 'theme' },
      'corner': { mood: 'danger' },
      'church-basement': { mood: 'sparse' },
      'rooftop': { mood: 'sparse' },
      'high-rise': { mood: 'danger' },
      'the-pjs': { mood: 'danger' },
      'legends': { mood: 'theme' },
      'king': { mood: 'king' },
    });
  });

  it('all twelve venues keep their beds verbatim (the Porch bed is a story override, not a venue change)', () => {
    expect(ROOM_STYLES.map((r) => [r.venue, r.bed])).toEqual([
      ['classic', 'none'], ['backyard', 'cookout'], ['mansion', 'mansion'], ['barbershop', 'barbershop'],
      ['church', 'basement'], ['rooftop', 'rooftop'], ['speakeasy', 'jazz'], ['vegas', 'casino'],
      ['beach', 'beach'], ['grandma', 'kitchen'], ['yacht', 'yacht'], ['blockAfterDark', 'street'],
    ]);
  });

  it('the story track map gains only the porch entry', () => {
    expect(STORY_TRACK_FILE).toEqual({
      theme: 'story-theme', sparse: 'story-theme-sparse', danger: 'story-danger', king: 'story-king', porch: 'porch-theme',
    });
  });
});

describe('the two new tracks', () => {
  it('are original, uncredited, and fenced to their surfaces', () => {
    const porch = TRACKS.find((t) => t.file === 'porch-theme')!;
    const menu = TRACKS.find((t) => t.file === 'menu-soul')!;
    for (const t of [porch, menu]) {
      expect(t.license).toBe('Original');
      expect(t.artist).toBe('Bid Wit Me');
      expect(t.credit).toBeUndefined();
    }
    expect(porch.storyOnly).toBe(true);
    expect(menu.menuOnly).toBe(true);
  });

  it('ship as files in the music folder', () => {
    for (const f of ['porch-theme', 'menu-soul']) {
      expect(existsSync(new URL(`../public/audio/music/${f}.mp3`, import.meta.url)), f).toBe(true);
    }
  });

  it('never enter the general pool (pool is still the 22 approved tracks)', () => {
    const pool = generalPool();
    expect(pool.length).toBe(22);
    const files = pool.map((i) => TRACKS[i]!.file);
    expect(files).not.toContain('porch-theme');
    expect(files).not.toContain('menu-soul');
    expect(files).toContain('windows-down');
  });
});

describe('menu music resolution', () => {
  const pick = () => (sound as unknown as { pickNext(): number }).pickNext();

  it('menu context resolves to the menu theme, every pick', () => {
    sound.setStoryStop(null);
    sound.enterContext('menu');
    for (let i = 0; i < 3; i++) expect(TRACKS[pick()]!.file).toBe('menu-soul');
  });

  it('a story mood still outranks the menu theme (story scenes keep their score)', () => {
    sound.setStoryStop('king');
    expect(TRACKS[pick()]!.file).toBe('story-king');
    sound.setStoryStop('porch');
    expect(TRACKS[pick()]!.file).toBe('porch-theme');
    sound.setStoryStop(null);
  });

  it('game context never resolves to the menu theme — it draws from the general pool', () => {
    sound.enterContext('game');
    const pool = new Set(generalPool());
    for (let i = 0; i < 6; i++) expect(pool.has(pick())).toBe(true);
    sound.enterContext('menu');
  });
});

describe('film mix targets (the reactivity, as data)', () => {
  it('bidding thins the score: dark filter, whisper gain, room untouched, people lean in', () => {
    const t = filmTargets('bidding');
    expect(t.scoreHz).toBeLessThan(1000);
    expect(t.scoreGain).toBeGreaterThan(0.2);
    expect(t.scoreGain).toBeLessThan(0.5);
    expect(t.tone).toBe(1);
    expect(t.human).toBeGreaterThan(1);
  });

  it('every other phase rests at the full, open mix', () => {
    for (const phase of ['playing', 'handOver', 'gameOver', 'scene']) expect(filmTargets(phase)).toBe(FILM_NEUTRAL);
    expect(FILM_NEUTRAL).toEqual({ scoreHz: 18000, scoreGain: 1, tone: 1, human: 1, world: 1 });
  });

  it('a set drops the score below even the bidding register while the room reacts', () => {
    expect(FILM_SET_DIP.scoreHz).toBeLessThan(filmTargets('bidding').scoreHz);
    expect(FILM_SET_DIP.scoreGain).toBeLessThan(filmTargets('bidding').scoreGain);
    expect(FILM_SET_DIP.human).toBeGreaterThan(1.4);
    expect(FILM_SET_DIP.world).toBeLessThan(1);
  });

  it('the blast ducks everything — score and all three layers', () => {
    expect(FILM_BLAST.scoreGain).toBeLessThan(0.3);
    expect(FILM_BLAST.tone).toBeLessThan(0.3);
    expect(FILM_BLAST.human).toBeLessThan(0.3);
    expect(FILM_BLAST.world).toBeLessThan(0.3);
  });
});

describe('film mix wiring (source pins)', () => {
  const src = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
  const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');

  it('the music chain carries the score-treatment stage', () => {
    expect(src).toContain('this.filmFilter = c.createBiquadFilter()');
    expect(src).toContain('input.connect(this.filmFilter).connect(this.filmGain)');
  });

  it('the Porch bed is built as three separately ridable layers', () => {
    expect(src).toContain("case 'porch': {");
    expect(src).toContain('this.filmLayers = { tone: toneLayer, human: humanLayer, world: worldLayer }');
    for (const marker of ['ROOM TONE', 'CLOSE HUMAN SOUNDS', 'THE OUTSIDE WORLD']) expect(src, marker).toContain(marker);
  });

  it('bid / set / nuke hooks are wired: Table feeds phases, play() dips on set + blast', () => {
    expect(table).toContain('sound.setFilmPhase(st.phase)');
    expect(src).toContain("if (name === 'set') this.filmDip(FILM_SET_DIP, 2600);");
    expect(src).toContain("else if (name === 'nuke') this.filmDip(FILM_BLAST, DUCK_MS.nuke ?? 3600);");
    expect(src).toContain("else if (name === 'mega') this.filmDip(FILM_BLAST, DUCK_MS.mega ?? 4400);");
  });

  it('the film controller only acts while the Porch mood is live', () => {
    expect(src).toContain("private filmActive(): boolean { return this.storyMood === 'porch'; }");
    expect(src).toContain('if (!this.filmActive()) return;');
  });

  it('the phase feed is safe with no audio context (menus, tests, locked audio)', () => {
    sound.setFilmPhase('bidding');
    sound.setStoryStop('porch');
    expect(sound.storyMood).toBe('porch');
    sound.setFilmPhase('playing');
    sound.setStoryStop(null);
    expect(sound.storyMood).toBeNull();
  });
});
