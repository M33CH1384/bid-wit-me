/**
 * Wave D venue life (§A7 row 72 + §A1 row 13): ONE shared life layer —
 * per-venue parameter sets, seekable deterministic channels, and the
 * Pj's drive-by sweep model slaved to the audio scheduler's envelope.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VENUES } from '@spades/protocol';
import {
  HEADLIGHT_SWEEP_SEC, VENUE_LIFE, dustMoteAt, flickerAt, glowAt, hazeSwayAt,
  headlightCalmAt, headlightSweepAt, lifeHash, lifePhase, lifeSeed, smokePuffAt,
  venueLifeFor, venueLifeFrameAt,
} from '../src/venueLife';

const src = (rel: string) => readFileSync(join(process.cwd(), 'apps/web/src', rel), 'utf8');

describe('venue life — one system, every room', () => {
  it('a parameter set exists for every venue, with counts at or below the shipped caps', () => {
    expect(Object.keys(VENUE_LIFE).sort()).toEqual([...VENUES].sort());
    for (const v of VENUES) {
      const p = venueLifeFor(v);
      expect(p.id).toBe(v);
      if (p.smoke) expect(p.smoke.count).toBeLessThanOrEqual(14);
      expect(p.dust.count).toBeLessThanOrEqual(12);
      expect(p.glow.hi).toBeGreaterThan(p.glow.lo);
      expect(p.flicker.depth).toBeGreaterThanOrEqual(0);
      expect(p.flicker.depth).toBeLessThan(0.5); // ambience buzzes, it never cuts (the cut is the set cover's)
    }
  });

  it('registers read right: the streetlight buzzes hardest, the kitchen is steadiest', () => {
    expect(VENUE_LIFE.blockAfterDark.flicker.depth).toBeGreaterThan(VENUE_LIFE.grandma.flicker.depth);
    expect(VENUE_LIFE.blockAfterDark.flicker.depth).toBeGreaterThan(VENUE_LIFE.speakeasy.flicker.depth);
    expect(VENUE_LIFE.grandma.smoke).not.toBeNull(); // steam off the pie
    expect(VENUE_LIFE.speakeasy.smoke?.opacity).toBeLessThan(VENUE_LIFE.blockAfterDark.smoke!.opacity); // lounge haze is thin
    expect(VENUE_LIFE.classic.smoke).toBeNull();
  });

  it('deterministic: same t, same frame — and no Math.random / Date.now in the model', () => {
    for (const v of VENUES) {
      expect(venueLifeFrameAt(v, 3.7)).toEqual(venueLifeFrameAt(v, 3.7));
      expect(venueLifeFrameAt(v, 3.7)).not.toEqual(venueLifeFrameAt(v, 4.9));
    }
    const model = src('venueLife.ts');
    // strip comments before scanning for the banned clocks
    const code = model.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    expect(code).not.toContain('Math.random');
    expect(code).not.toContain('Date.now');
  });

  it('seekable loops: every channel repeats exactly on its own period, no drift', () => {
    for (const v of VENUES) {
      const p = venueLifeFor(v);
      for (const t of [0, 1.3, 7.77]) {
        expect(glowAt(p, t)).toBeCloseTo(glowAt(p, t + p.glow.periodSec), 10);
        expect(hazeSwayAt(p, t)).toBeCloseTo(hazeSwayAt(p, t + p.haze.periodSec), 10);
        if (p.smoke) expect(smokePuffAt(p, 3, t).y).toBeCloseTo(smokePuffAt(p, 3, t + p.smoke.periodSec).y, 10);
        expect(dustMoteAt(p, 2, t).opacity).toBeCloseTo(dustMoteAt(p, 2, t + p.dust.periodSec).opacity, 10);
      }
      expect(lifePhase(0, 4)).toBe(0);
      expect(lifePhase(4, 4)).toBe(0);
      expect(lifeHash(42)).toBe(lifeHash(42));
      expect(lifeSeed('grandma')).not.toBe(lifeSeed('blockAfterDark'));
    }
  });

  it('channels stay in range across a long sweep of t', () => {
    for (const v of VENUES) {
      const p = venueLifeFor(v);
      for (let t = 0; t < 120; t += 0.37) {
        const f = venueLifeFrameAt(v, t);
        expect(f.flicker).toBeGreaterThan(0.3); // never a black room from ambience
        expect(f.flicker).toBeLessThanOrEqual(1);
        expect(f.glow).toBeGreaterThanOrEqual(p.glow.lo - 1e-9);
        expect(f.glow).toBeLessThanOrEqual(p.glow.hi + 1e-9);
        for (const puff of f.smoke) { expect(puff.opacity).toBeGreaterThanOrEqual(0); expect(puff.opacity).toBeLessThanOrEqual(p.smoke!.opacity + 1e-9); }
      }
      // the streetlight actually buzzes: its level varies, the kitchen's barely does
      const swing = (id: typeof v) => { const q = venueLifeFor(id); let lo = 1, hi = 0; for (let t = 0; t < 30; t += 0.05) { const x = flickerAt(q, t); lo = Math.min(lo, x); hi = Math.max(hi, x); } return hi - lo; };
      expect(swing('blockAfterDark')).toBeGreaterThan(swing('grandma') * 2);
    }
  });
});

describe("Pj's drive-by — visual model slaved to the audio envelope", () => {
  it('held timing: 4.6 s exactly (audio.ts headlightPass: pan 4.4 s, gain gone by 4.6 s)', () => {
    expect(HEADLIGHT_SWEEP_SEC).toBe(4.6);
    const audio = src('audio.ts');
    expect(audio).toContain("window.dispatchEvent(new CustomEvent('pj-headlights'))");
    expect(audio).toContain('linearRampToValueAtTime(11, t + 4.4)');
    expect(audio).toContain('exponentialRampToValueAtTime(0.0001, t + 4.6)');
  });

  it('two beams travel left→right, peak abreast of the listener, then only taillight remains', () => {
    const a = headlightSweepAt(0);
    expect(a.beamX).toBe(-20); expect(a.envelope).toBe(0);
    const mid = headlightSweepAt(2.2);
    expect(mid.beamX).toBeGreaterThan(45); expect(mid.beamX).toBeLessThan(52);
    expect(mid.beamR - mid.beamL).toBeCloseTo(9, 5); // two lamps, apart
    expect(mid.envelope).toBeGreaterThan(0.8);
    expect(mid.stripe).toBeGreaterThan(0.8); // fence striping peaks mid-rake
    const late = headlightSweepAt(3.9);
    expect(late.tailOpacity).toBeGreaterThan(0.2);
    expect(late.tailX).toBeLessThan(late.beamX - 10); // taillight trails the beams
    const end = headlightSweepAt(4.6);
    expect(end.beamX).toBe(120); expect(end.envelope).toBe(0); expect(end.tailOpacity).toBe(0);
    // monotone travel: the car never goes backwards
    let last = -Infinity;
    for (let t = 0; t <= 4.6; t += 0.2) { const x = headlightSweepAt(t).beamX; expect(x).toBeGreaterThanOrEqual(last); last = x; }
  });

  it('calm read is a held frame: beams parked abreast, opacity envelope only', () => {
    expect(headlightCalmAt(0).opacity).toBe(0);
    expect(headlightCalmAt(2.3).opacity).toBe(1);
    expect(headlightCalmAt(2.3).beamX).toBe(50);
    expect(headlightCalmAt(4.6).opacity).toBe(0);
  });

  it('consumers: Venue3D streetlife, cube-room pulse, story dust — all read the one model', () => {
    const venue3d = src('three/Venue3D.tsx');
    expect(venue3d).toContain("case 'blockAfterDark': return <PjsLife fxOn={fxOn} />");
    expect(venue3d).toContain('flickerAt'); // streetlight buzz channel
    expect(venue3d).toContain('smokePuffAt'); // deterministic smoke, seeded by the model
    expect(venue3d).not.toContain('Math.random() * spread'); // the old per-mount random smoke seeds are gone
    const cube = src('three/cubeVenue.tsx');
    expect(cube).toContain('CubeLifePulse');
    expect(cube).toContain('glowAt(life, t) * flickerAt(life, t)');
    // every cube room now carries a point light for the pulse to breathe
    for (const f of ['grandmaLayout.ts', 'mansionLayout.ts', 'churchLayout.ts', 'speakeasyLayout.ts', 'backyardLayout.ts', 'beachLayout.ts', 'rooftopLayout.ts', 'vegasLayout.ts', 'yachtLayout.ts']) {
      expect(src(`three/${f}`), f).toContain('points:');
    }
    // story living scenes: the dust layer rides the mood's own dust clock
    const living = src('story/storyLiving.ts');
    expect(living).toContain("'--lv-dust-dur'");
    const css = readFileSync(join(process.cwd(), 'apps/web/src/story/story.css'), 'utf8');
    expect(css).toContain('.story-scene-dust');
    expect(css).toContain('var(--lv-dust-dur, 21s)');
    expect(src('story/ScriptPlayer.tsx')).toContain('story-scene-dust');
  });

  it('the layer renders the model: two beams + fence stripes + taillight, event + testid unchanged', () => {
    const layer = src('animfx/AnimFxLayer.tsx');
    expect(layer).toContain("window.addEventListener('pj-headlights', h)");
    expect(layer).toContain('data-testid="pj-headlights"');
    expect(layer).toContain('animfx-hl-beam');
    expect(layer).toContain('animfx-hl-fence');
    expect(layer).toContain('animfx-hl-tail');
    const css = src('animfx/animfx.css');
    const block = css.slice(css.indexOf('/* ---- 13.'), css.indexOf('/* ================= wave 2'));
    expect(block).toContain('4.6s'); // held duration
    expect(block).toContain('repeating-linear-gradient'); // fence striping
    // travel runs on transform (compositor), never background-position painting
    expect(block).not.toContain('background-position:');
    expect(block).toContain('@keyframes animfx-hl-beam');
    expect(block).toContain('@keyframes animfx-hl-tail');
  });
});
