/**
 * Scene persistence across games (perf fix A, 2026-11-03): structural
 * pins for the architecture that killed the per-game reload tax.
 * The measured defect: every game rebuilt the WebGL stack from
 * scratch — a new Canvas/context per Table remount, shader linking at
 * 62–85% of the load-phase main thread, ~68 MB of figures re-fetched,
 * re-decoded and re-uploaded per game, on a hotter phone each time.
 *
 * The shape that fixes it, pinned here so it cannot silently regress:
 *  - Table's default export is a session SHELL; the per-game table
 *    (TableGame) is keyed by seed INSIDE it, and surfaces no longer
 *    key the shell by game.
 *  - The shell portals the Scene into the current game's slot and
 *    never lets a departing slot unmount it.
 *  - Inside the Scene, the GPU-resource subtree remounts per gameSeed
 *    (per-game certifications fire as before) while the Canvas, its
 *    context and the load ramp persist.
 *  - Crash round 4's discipline survives at the new boundary: the
 *    unmount shed + tornDownRef accounting stay, and a transition
 *    shed keyed on the new game's loadSettled joins them.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');

describe('scene persistence structure', () => {
  it('Table is a shell keying the per-game table by seed', () => {
    const table = src('Table.tsx');
    expect(table).toContain('function TableGame(');
    expect(table).toContain('export default function Table(props: Props)');
    expect(table).toContain('<TableGame key={props.seed}');
    expect(table).toContain('createScenePropStore');
    expect(table).toContain('createPortal(');
    // the portal target is ONE permanent element for the shell's life
    // (a fresh target per game remounts the portal's children — the
    // context died anyway); only live anchors are adopted, and a
    // departing game re-homes the element before its screen detaches
    expect(table).toContain('if (el) setAnchor(el)');
    expect(table).toContain('rehomeScene');
    expect(table).toContain('anchor.appendChild(portalEl)');
  });

  it('surfaces no longer key the shell by game', () => {
    expect(src('App.tsx')).not.toContain('key={game.seed}');
    expect(src('story/StoryHome.tsx')).not.toContain('key={screen.seed}');
    const online = src('online/OnlineTable.tsx');
    expect(online).toContain('key={room.code}');
    expect(online).not.toContain('key={`${room.code}:${room.game}`}');
    // the seed prop still names the game, so the shell key works
    expect(online).toContain('seed={`${room.code}:${room.game}`}');
  });

  it('the scene remounts its resource subtree per gameSeed, not its Canvas', () => {
    const scene = src('three/Scene.tsx');
    expect(scene).toContain("<Fragment key={props.gameSeed ?? ''}>");
    expect(scene).toContain("<FirstFrameSignal key={props.gameSeed ?? ''}");
    // the ramp and rig stay outside the per-game subtree
    const rampAt = scene.indexOf('<ResumeRamp');
    const fragAt = scene.indexOf("<Fragment key={props.gameSeed ?? ''}>");
    expect(rampAt).toBeGreaterThan(-1);
    expect(fragAt).toBeGreaterThan(rampAt);
  });

  it('crash round 4 semantics survive at the new boundary', () => {
    const scene = src('three/Scene.tsx');
    expect(scene).toContain('lost-teardown');
    expect(scene).toContain('tornDownRef');
    // session-end shed in the unmount cleanup…
    expect(scene).toContain('enterFigureLeanMode();');
    // …and the transition shed, gated on the new game having settled
    expect(scene).toContain('props.loadSettled');
    expect(scene).toContain('shedDoneRef');
    // onCreated listeners read venue/quality live, not from mount
    expect(scene).toContain('liveVenueRef');
  });
});
