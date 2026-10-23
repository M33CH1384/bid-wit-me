/**
 * @vitest-environment happy-dom
 *
 * The King's gun (owner, 2026-10-21): the between-legs set-piece stages a
 * revolver on the table as the King states the double's terms, and the
 * same gun lies on the 3D felt for the whole of leg 2. Pins: the scene
 * player reserves the prop strip from the first beat (the layout-jump
 * rule) and sets the piece down exactly on its marked beat; scenes
 * without a marked beat render no strip at all; and the table gate
 * (kingGunSeatFor) keys the felt prop to the LIVE double-pending fact —
 * leg 2 fresh, run back, or resumed — and to nothing else (not leg 1,
 * not post-completion replays, not other stops).
 */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORY_STOPS, kingDoubleBeats, type StoryStop } from '@spades/bots';
import ScriptPlayer from '../src/story/ScriptPlayer';
import { kingGunSeatFor } from '../src/Table';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let roots: Root[] = [];
async function renderEl(el: React.ReactElement): Promise<HTMLElement> {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const root = createRoot(c);
  roots.push(root);
  await act(async () => { root.render(el); });
  return c;
}
const click = async (el: Element) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
afterEach(async () => {
  for (const r of roots) await act(async () => { r.unmount(); });
  roots = [];
  document.body.innerHTML = '';
  localStorage.clear();
});

const king = STORY_STOPS.find((s) => s.id === 'king')!;
const porch = STORY_STOPS.find((s) => s.id === 'porch')!;
const noop = () => {};

describe("the between-legs scene: the gun is set down on its beat", () => {
  const CAST = ['king', 'dee', 'ringer'];
  it('the started set-piece reserves the strip from the first beat, with the piece already down (the King opens on the gun)', async () => {
    const c = await renderEl(createElement(ScriptPlayer, { beats: kingDoubleBeats('started'), cta: 'Run it back — leg 2', onDone: noop, cast: CAST }));
    const strip = c.querySelector('[data-testid="story-king-gun"]');
    expect(strip).not.toBeNull();
    expect(strip!.classList.contains('down')).toBe(true); // beat 0 IS the gun beat
    expect(strip!.querySelector('svg')).not.toBeNull();
  });

  it('a prop marked on a later beat: the strip is reserved from mount and the piece lands only when the beat does', async () => {
    const beats = [
      { speaker: 'dee', line: 'We did it. Once.' },
      { speaker: 'king', prop: 'kingGun' as const, line: 'Sit back down.' },
    ];
    const c = await renderEl(createElement(ScriptPlayer, { beats, cta: 'Next', onDone: noop, cast: CAST }));
    const strip = () => c.querySelector('[data-testid="story-king-gun"]');
    expect(strip()).not.toBeNull(); // reserved — nothing reflows when it lands
    expect(strip()!.classList.contains('down')).toBe(false);
    const next = () => c.querySelector('[data-testid="story-script-next"]')!;
    await click(next()); // finish typing beat 1
    await click(next()); // advance to the gun beat
    expect(strip()!.classList.contains('down')).toBe(true);
  });

  it('the lost set-piece stages no prop at all — the run is over', async () => {
    const onDone = vi.fn();
    const c = await renderEl(createElement(ScriptPlayer, { beats: kingDoubleBeats('lost'), cta: 'Back to the map', onDone, cast: CAST }));
    expect(c.querySelector('[data-testid="story-king-gun"]')).toBeNull();
  });
});

describe('the felt prop gate: kingGunSeatFor', () => {
  const storyAt = (stop: StoryStop, doublePending?: boolean) => ({
    scene: { stop, facts: { attempts: 2, cleared: false, ...(doublePending === undefined ? {} : { doublePending }) } },
  });

  it("the King's seat (1) while the double is pending — fresh leg 2, run-back, or resume alike", () => {
    expect(kingGunSeatFor(storyAt(king, true))).toBe(1);
  });

  it('no gun in leg 1 (nothing pending yet)', () => {
    expect(kingGunSeatFor(storyAt(king, false))).toBeNull();
    expect(kingGunSeatFor(storyAt(king))).toBeNull();
  });

  it('no gun in post-completion replays (the double is resolved)', () => {
    expect(kingGunSeatFor(storyAt(king, false))).toBeNull();
  });

  it('no gun at any other stop, even with a pending-shaped fact', () => {
    expect(kingGunSeatFor(storyAt(porch, true))).toBeNull();
  });

  it('no gun without a story scene at all', () => {
    expect(kingGunSeatFor(undefined)).toBeNull();
    expect(kingGunSeatFor({})).toBeNull();
  });
});

describe('wiring pins', () => {
  it('StoryHome plays the started set-piece on the leg-1-win transition', () => {
    const home = readFileSync('apps/web/src/story/StoryHome.tsx', 'utf8');
    expect(home).toContain("kingDoubleBeats('started')");
    expect(home).toContain("r.doubleOutcome === 'started'");
  });

  it('Table hands the gate to the 3D scene; the scene renders the prop from it', () => {
    const table = readFileSync('apps/web/src/Table.tsx', 'utf8');
    const scene = readFileSync('apps/web/src/three/Scene.tsx', 'utf8');
    // the solo gate first; the online binding's seat (the co-op finale's
    // cutthroat, Phase 4) is the fallback — the prop is the same piece
    expect(table).toContain('kingGunSeat={kingGunSeatFor(story) ?? online?.kingGunSeat ?? null}');
    expect(scene).toContain('kingGunSeat');
    expect(scene).toContain('kingGunSpot');
    expect(scene).toContain('<KingGun');
  });

  it('the co-op finale wires the same prop through the online binding (Phase 4)', () => {
    const online = readFileSync('apps/web/src/online/OnlineTable.tsx', 'utf8');
    expect(online).toContain("room.story?.stopId === 'king' && room.story.phase === 'finale-game' ? rot.L(1) : null");
  });
});
