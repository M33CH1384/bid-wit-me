/**
 * The persona-figures pins (regular-table bot bodies; owner directive
 * 2026-10-29 23:58 EDT: "Build them").
 *
 * Regular (non-story) tables seat rigged 3D figures for bot personas
 * whose figure has shipped, High quality only. These tests pin: the
 * key resolution (the figure key IS the portrait key, so face and
 * body can never disagree), the shipped-set completeness (Batch C
 * closed the roster: all 38 persona x gender keys ship, so only an
 * empty name resolves null), the seam wiring
 * through Table -> Scene -> PersonaFigures with story tables
 * excluded on both paths, the LAZY loader-gate decision (persona
 * GLBs are NOT in the asset gate — they stream in over the portrait
 * treatment and degrade to it on failure), the failure discipline
 * (declarative loads, error boundary, probe), and the per-venue seat
 * geometry (spots + seat tops measured from the room sources — the
 * solve sits figures in the rooms' OWN chairs, not a fleet guess).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { roomGlbUrls } from '../src/assetGate';
import { PERSONA_FIGURE_KEYS, personaFigureKeyForName } from '../src/personaFigureKey';

const src = (p: string) => readFileSync(join(process.cwd(), 'apps/web', p), 'utf8');

describe('figure-key resolution', () => {
  it('Batches A+B+C ship the complete 38-key roster', () => {
    expect([...PERSONA_FIGURE_KEYS].sort()).toEqual(
      ['barber-f', 'barber-m', 'coach-f', 'coach-m', 'comedian-f',
       'comedian-m', 'conspiracy-f', 'conspiracy-m', 'deacon-f', 'deacon-m',
       'gambler-f', 'gambler-m', 'hothead-f', 'hothead-m', 'hustler-f',
       'hustler-m', 'hype-f', 'hype-m', 'influencer-f', 'influencer-m',
       'lilcuz-f', 'lilcuz-m', 'mama-f', 'mama-m', 'og-f', 'og-m',
       'petty-f', 'petty-m', 'professor-f', 'professor-m', 'silent-f',
       'silent-m', 'smooth-f', 'smooth-m', 'sorelose-f', 'sorelose-m',
       'storyteller-f', 'storyteller-m'],
    );
  });

  it('resolves names to the same key their portrait plate uses', () => {
    expect(personaFigureKeyForName('Ingrid')).toBe('coach-f'); // the owner's named case
    expect(personaFigureKeyForName('Zuri')).toBe('coach-f');
    expect(personaFigureKeyForName('Marcus')).toBe('mama-m');
    expect(personaFigureKeyForName('Tunde')).toBe('mama-m');
    expect(personaFigureKeyForName('Keisha')).toBe('influencer-f');
    expect(personaFigureKeyForName('Unc')).toBe('og-m');
    expect(personaFigureKeyForName('Tasha')).toBe('hype-f');
    expect(personaFigureKeyForName('Luis')).toBe('smooth-m');
    expect(personaFigureKeyForName('Smoke')).toBe('smooth-m'); // persona face, NOT the story rig
    expect(personaFigureKeyForName('Ravi')).toBe('professor-m'); // Batch B
    expect(personaFigureKeyForName('Queenie')).toBe('mama-f'); // Batch B
    expect(personaFigureKeyForName('DeShawn')).toBe('coach-m');
    expect(personaFigureKeyForName('Carmen')).toBe('conspiracy-f');
    expect(personaFigureKeyForName('Big Mike')).toBe('hothead-m');
    expect(personaFigureKeyForName('Malik')).toBe('hustler-m');
    expect(personaFigureKeyForName('Aaliyah')).toBe('comedian-f');
    expect(personaFigureKeyForName('Peaches')).toBe('barber-f');
    expect(personaFigureKeyForName('Anjali')).toBe('deacon-f');
    expect(personaFigureKeyForName('Priya')).toBe('hothead-f');
    expect(personaFigureKeyForName('Boo')).toBe('hustler-f'); // Batch C
    expect(personaFigureKeyForName('Jojo')).toBe('hustler-f'); // Batch C
    expect(personaFigureKeyForName('Kiara')).toBe('silent-f'); // Batch C
    expect(personaFigureKeyForName('Jasmine')).toBe('sorelose-f'); // Batch C
  });

  it('with the roster complete, only the empty name resolves null', () => {
    // every persona x gender key ships a figure, so personaForName x
    // voiceGender always lands in the shipped set for a real name
    expect(personaFigureKeyForName('')).toBeNull();
  });

  it('the shipped GLBs exist in the production tree, full-size', () => {
    for (const key of PERSONA_FIGURE_KEYS) {
      const st = statSync(join(process.cwd(), 'apps/web', 'public', 'assets/figures/personas', `${key}.glb`));
      // rigged + grafted + q95-textured bodies are megabytes, not stubs
      expect(st.size).toBeGreaterThan(1_500_000);
    }
  });
});

describe('the lazy loader-gate decision', () => {
  it('persona GLBs are NOT in the asset gate at any seam', () => {
    for (const venue of ['classic', 'grandma', 'mansion', 'beach'] as const) {
      for (const g of roomGlbUrls(venue, 'high', null)) {
        expect(g.url).not.toContain('/assets/figures/personas/');
      }
    }
    expect(src('src/assetGate.ts')).not.toContain('personas/');
    expect(src('src/assetGate.ts')).not.toContain('PersonaFigures');
  });

  it('the figures module lazy-loads with the portrait fallback discipline', () => {
    const fig = src('src/three/PersonaFigures.tsx');
    expect(fig).toContain('useLoader(GLTFLoader, url)');
    expect(fig).toContain('<Suspense fallback={null}>');
    expect(fig).not.toContain('new GLTFLoader');
    expect(fig).toContain('__bwmPersonaFigures');
    expect(fig).toContain('getDerivedStateFromError');
    expect(fig).toContain('return this.state.failed ? null : this.props.children');
  });
});

describe('the seam wiring', () => {
  it('Table computes persona seats for non-story tables only, bot seats only', () => {
    const table = src('src/Table.tsx');
    expect(table).toContain('!story && !online?.storyStopId');
    expect(table).toContain('personaFigureKeyForName(names[seat]');
    expect(table).toContain('isBotSeat(seat) ? personaFigureKeyForName');
    expect(table).toContain('personaFigureSeats={personaFigureSeats}');
  });

  it('Scene activates the layer on non-story + High + the prop, and only there', () => {
    const scene = src('src/three/Scene.tsx');
    expect(scene).toContain("const personaFiguresActive = !props.storyStopId && hi && !!(props.personaFigureSeats?.some(Boolean))");
    expect(scene).toContain('{showTable && textured && personaFiguresActive && (');
    expect(scene).toContain('<PersonaFigures');
    expect(scene).toContain('venue={def.id}');
    // the story systems are untouched by the persona layer
    expect(scene).toContain('{showTable && textured && storyFiguresActive && (');
    expect(scene).toContain('seated={props.seatedFigures ?? []}');
  });

  it('three.js stays out of the entry graph: Table imports only the key module', () => {
    expect(src('src/Table.tsx')).not.toMatch(/from '\.\/three\/PersonaFigures'/);
    expect(src('src/Table.tsx')).toContain("from './personaFigureKey'");
    expect(src('src/personaFigureKey.ts')).not.toMatch(/from 'three/);
  });

  it('never fakes a blink (no morph machinery)', () => {
    expect(src('src/three/PersonaFigures.tsx')).not.toContain('morphTarget');
  });
});

describe('per-venue seat geometry (pinned against the room sources)', () => {
  const fig = src('src/three/PersonaFigures.tsx');

  /** seatTop value PersonaFigures carries for a venue */
  const seatTopOf = (venue: string): number => {
    const m = fig.match(new RegExp(`${venue}: \\{ spots: (?:CHAIR_SPOTS|KIT_SPOTS), seatTop: (-?[0-9.]+)`));
    expect(m, `venue ${venue} present in VENUE_SEAT_GEOMETRY`).toBeTruthy();
    return parseFloat(m![1]!);
  };

  /** the sitting surface a room's chair geometry builds: floor + seat box top */
  const roomSeatTop = (file: string, pattern: RegExp, floor = -0.9): number => {
    const roomSrc = src(`src/three/${file}`);
    const m = roomSrc.match(pattern);
    expect(m, `${file} seat geometry found`).toBeTruthy();
    // patterns capture (thickness, centreY): surface = floor + centreY + thickness / 2
    return floor + parseFloat(m![2]!) + parseFloat(m![1]!) / 2;
  };

  it('kit rooms: the solve seat top is the room chair\u2019s own surface', () => {
    const seatBox = /seatParts\.push\(box\([0-9.]+, ([0-9.]+), [0-9.]+, 0, ([0-9.]+), 0\.02\)\)/;
    expect(seatTopOf('barbershop')).toBeCloseTo(roomSeatTop('BarbershopMirrorRoom.tsx', seatBox), 3);
    expect(seatTopOf('backyard')).toBeCloseTo(roomSeatTop('CookoutYardRoom.tsx', seatBox), 3);
    expect(seatTopOf('church')).toBeCloseTo(roomSeatTop('ChurchBasementRoom.tsx', seatBox), 3);
    expect(seatTopOf('speakeasy')).toBeCloseTo(roomSeatTop('SpeakeasyLoungeRoom.tsx', seatBox), 3);
    expect(seatTopOf('grandma')).toBeCloseTo(roomSeatTop('GrandmasKitchenRoom.tsx', /seatParts\.push\(box\([0-9.]+, ([0-9.]+), [0-9.]+, 0, ([0-9.]+), 0\.02\)\)/), 3);
  });

  it('rooftop / yacht / vegas: slat and pad surfaces', () => {
    // rooftop: slats sit on the frame — surface = slat centre + half thickness
    expect(seatTopOf('rooftop')).toBeCloseTo(
      roomSeatTop('RooftopSkylineRoom.tsx', /slatParts\.push\(box\(0\.40, ([0-9.]+), 0\.09, 0, ([0-9.]+), 0\.01 \+ fz\)\)/), 3);
    // yacht: the deck pad is the sitting surface
    expect(seatTopOf('yacht')).toBeCloseTo(
      roomSeatTop('YachtDeckRoom.tsx', /padParts\.push\(box\(0\.40, ([0-9.]+), 0\.38, 0, ([0-9.]+), 0\.01\)\)/), 2);
    // vegas: the casino pad is the sitting surface
    expect(seatTopOf('vegas')).toBeCloseTo(
      roomSeatTop('VegasCasinoRoom.tsx', /padParts\.push\(box\(0\.42, ([0-9.]+), 0\.40, 0, ([0-9.]+), 0\.01\)\)/), 3);
  });

  it('beach: the raised deck lifts both the seat top and the foot floor', () => {
    const beach = src('src/three/BeachCabanaRoom.tsx');
    expect(beach).toContain('const DECK_TOP = FLOOR_Y + 0.045');
    // the beach chairs ride the deck: same kit spots, DECK_TOP in place of FLOOR_Y
    expect(beach).toContain('pos: [0, DECK_TOP, 1.98], ry: Math.PI');
    expect(beach).toContain('pos: [2.14, DECK_TOP, 0], ry: -Math.PI / 2');
    expect(beach).toContain('pos: [0, DECK_TOP, -1.98], ry: 0');
    expect(beach).toContain('pos: [-2.14, DECK_TOP, 0], ry: Math.PI / 2');
    const expected = -0.9 + 0.045 + 0.47 + 0.04 / 2; // DECK_TOP + cabana seat box top
    expect(seatTopOf('beach')).toBeCloseTo(expected, 3);
    expect(fig).toContain('beach: { spots: KIT_SPOTS, seatTop: -0.365, floorY: -0.855 }');
  });

  it('penthouse: the documented 0.45 seat height', () => {
    expect(src('src/three/HighRisePenthouseRoom.tsx')).toContain('seat top 0.45');
    expect(seatTopOf('mansion')).toBeCloseTo(-0.9 + 0.45, 3);
  });

  it('the Pj\u2019s folding chairs and the fleet standard share −0.41', () => {
    expect(src('src/three/PjsStreetRoom.tsx')).toContain('seat — top at 0.492');
    expect(seatTopOf('blockAfterDark')).toBeCloseTo(-0.41, 2);
    expect(seatTopOf('classic')).toBeCloseTo(-0.41, 10);
  });

  it('kit spots in the rooms match the layout the solve uses', () => {
    for (const file of ['GrandmasKitchenRoom.tsx', 'VegasCasinoRoom.tsx', 'BarbershopMirrorRoom.tsx', 'ChurchBasementRoom.tsx']) {
      const roomSrc = src(`src/three/${file}`);
      expect(roomSrc).toContain('pos: [0, FLOOR_Y, 1.98], ry: Math.PI');
      expect(roomSrc).toContain('pos: [2.14, FLOOR_Y, 0], ry: -Math.PI / 2');
      expect(roomSrc).toContain('pos: [0, FLOOR_Y, -1.98], ry: 0');
      expect(roomSrc).toContain('pos: [-2.14, FLOOR_Y, 0], ry: Math.PI / 2');
    }
    // the solve stores them re-ordered to (top, bottom, left, right)
    expect(fig).toContain('{ x: 0, z: -1.98, ry: 0 }');
    expect(fig).toContain('{ x: 0, z: 1.98, ry: Math.PI }');
    expect(fig).toContain('{ x: -2.14, z: 0, ry: Math.PI / 2 }');
    expect(fig).toContain('{ x: 2.14, z: 0, ry: -Math.PI / 2 }');
  });

  it('carries a register for every shipped key', () => {
    for (const key of PERSONA_FIGURE_KEYS) {
      expect(fig).toContain(`'${key}': {`);
    }
  });
});
