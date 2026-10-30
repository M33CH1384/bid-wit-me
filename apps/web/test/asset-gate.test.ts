import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ASSET_GATE_CAP_MS, PJS_BED_URL, SEDAN_GLB_URL, createAssetGate, gateLedgerFiles, gateLedgerVenue, imageSettled, loaderStillUp,
  noteRoomAssets, notedRoomAssets, roomAudioUrls, roomGlbUrls, storySeamMounts,
} from '../src/assetGate';
import { versusDismissReady } from '../src/VersusIntro';
import { deckArtUrlsFor, whenDeckArtSettled, whenDeckBackSettled } from '../src/decks';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('asset gate registry', () => {
  it('holds while an asset promise is pending and releases when it resolves', async () => {
    const gate = createAssetGate('test:hold', 60_000);
    let release!: (ok: boolean) => void;
    gate.add('room backdrop', new Promise<boolean>((r) => { release = r; }));
    gate.seal();
    let doneResult: unknown = null;
    void gate.done.then((r) => { doneResult = r; });
    await tick();
    expect(doneResult).toBeNull();
    expect(gate.progress()).toEqual({ settled: 0, total: 1, fraction: 0 });
    release(true);
    const r = await gate.done;
    expect(r.total).toBe(1);
    expect(r.settled).toBe(1);
    expect(r.failed).toEqual([]);
    expect(r.cappedOut).toBe(false);
    expect(doneResult).not.toBeNull();
  });

  it('does not resolve before seal, even with everything settled (late ledger fold)', async () => {
    const gate = createAssetGate('test:seal', 60_000);
    gate.add('a', Promise.resolve(true));
    let resolved = false;
    void gate.done.then(() => { resolved = true; });
    await tick();
    expect(resolved).toBe(false);
    gate.add('b', Promise.resolve(true));
    gate.seal();
    await gate.done;
    expect(resolved).toBe(true);
    expect((await gate.done).total).toBe(2);
  });

  it('a failed asset settles the gate and is named, so the fallback path proceeds', async () => {
    const gate = createAssetGate('test:fail', 60_000);
    gate.add('venue backdrop /assets/venues/x/bg.jpg', Promise.resolve(false));
    gate.add('glb sedan', Promise.reject(new Error('network')));
    gate.seal();
    const r = await gate.done;
    expect(r.cappedOut).toBe(false);
    expect(r.settled).toBe(2);
    expect(r.failed).toContain('venue backdrop /assets/venues/x/bg.jpg');
    expect(r.failed).toContain('glb sedan');
    expect(gate.failed()).toEqual(r.failed);
  });

  it('the cap releases the gate with pending assets named (no trapped loader)', async () => {
    vi.useFakeTimers();
    try {
      const gate = createAssetGate('test:cap', 1_000);
      gate.add('never answers', new Promise<boolean>(() => {}));
      gate.add('quick', Promise.resolve(true));
      gate.seal();
      const doneP = gate.done;
      await vi.advanceTimersByTimeAsync(999);
      let resolved = false;
      void doneP.then(() => { resolved = true; });
      await Promise.resolve();
      expect(resolved).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const r = await doneP;
      expect(r.cappedOut).toBe(true);
      expect(r.pendingAtCap).toEqual(['never answers']);
      expect(r.settled).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports progress as assets settle', async () => {
    const gate = createAssetGate('test:progress', 60_000);
    const seen: number[] = [];
    gate.onProgress(() => seen.push(gate.progress().fraction));
    gate.add('a', Promise.resolve(true));
    gate.add('b', Promise.resolve(true));
    gate.add('c', Promise.resolve(false));
    gate.seal();
    await gate.done;
    expect(gate.progress()).toEqual({ settled: 3, total: 3, fraction: 1 });
    expect(seen).toContain(1 / 3);
    expect(seen[seen.length - 1]).toBe(1);
  });

  it('duplicate labels register once', async () => {
    const gate = createAssetGate('test:dup', 60_000);
    gate.add('/assets/x.jpg', Promise.resolve(true));
    gate.add('/assets/x.jpg', Promise.resolve(true));
    gate.seal();
    const r = await gate.done;
    expect(r.total).toBe(1);
  });

  it('the cap is generous but bounded, under the loader 40s give-up', () => {
    expect(ASSET_GATE_CAP_MS).toBeGreaterThanOrEqual(10_000);
    expect(ASSET_GATE_CAP_MS).toBeLessThan(40_000);
  });
});

describe('loader composition (Table dismissal)', () => {
  it('holds while room assets are pending even with dressed + effects warm', () => {
    expect(loaderStillUp({ dressed: true, effectsWarm: true, assetsSettled: false, giveUp: false })).toBe(true);
  });
  it('holds while card art is pending (assets unsettled covers the deck tasks)', () => {
    expect(loaderStillUp({ dressed: true, effectsWarm: true, assetsSettled: false, giveUp: false })).toBe(true);
    expect(loaderStillUp({ dressed: true, effectsWarm: true, assetsSettled: true, giveUp: false })).toBe(false);
  });
  it('keeps the original conditions and the give-up override', () => {
    expect(loaderStillUp({ dressed: false, effectsWarm: true, assetsSettled: true, giveUp: false })).toBe(true);
    expect(loaderStillUp({ dressed: true, effectsWarm: false, assetsSettled: true, giveUp: false })).toBe(true);
    expect(loaderStillUp({ dressed: false, effectsWarm: false, assetsSettled: false, giveUp: true })).toBe(false);
  });
  it('the versus story floor is unchanged: assets alone never dismiss the intro', () => {
    // versusDismissReady is the untouched second condition: story incomplete
    // holds the loader no matter how ready the table (and its assets) are.
    expect(versusDismissReady({ storyComplete: false, tableReady: true })).toBe(false);
    expect(versusDismissReady({ storyComplete: true, tableReady: false })).toBe(false);
    expect(versusDismissReady({ storyComplete: true, tableReady: true })).toBe(true);
  });
});

describe('room asset enumeration', () => {
  it('the sedan rides only the high-quality street rooms', () => {
    expect(roomGlbUrls('blockAfterDark', 'high', null)).toEqual([{ label: expect.any(String), url: SEDAN_GLB_URL }]);
    expect(roomGlbUrls('blockAfterDark', 'high', 'pjs')).toEqual([{ label: expect.any(String), url: SEDAN_GLB_URL }]);
    expect(roomGlbUrls('speakeasy', 'high', 'corner')).toEqual([
      { label: expect.any(String), url: SEDAN_GLB_URL },
      { label: expect.any(String), url: '/assets/figures/dee.glb' },
      { label: expect.any(String), url: '/assets/figures/smoke.glb' },
      { label: expect.any(String), url: '/assets/figures/redd.glb' },
    ]);
    expect(roomGlbUrls('speakeasy', 'high', null)).toEqual([]);
    expect(roomGlbUrls('blockAfterDark', 'low', null)).toEqual([]);
    // the Porch deck ROOM is all-code, but the pilot's seated figures are
    // downloads the table presents — they gate at the porch seam (the
    // dedicated pins live in porch-figures.test.ts)
    expect(roomGlbUrls('grandma', 'high', 'porch').map((g) => g.url)).toEqual([
      '/assets/figures/dee.glb', '/assets/figures/uncleRay.glb', '/assets/figures/pat.glb',
    ]);
    expect(roomGlbUrls('grandma', 'high', null)).toEqual([]);
    expect(roomGlbUrls('grandma', 'low', 'porch')).toEqual([]);
    expect(roomGlbUrls('classic', 'high', null)).toEqual([]);
  });

  it("the Pj's recorded bed rides the gate at High street tables — never the king stop, never Low", () => {
    // Owner, 2026-10-30: the recorded night-street bed joins the Pj's loader gate
    // (the gate gains one unit at the regular venue and at the the-pjs stop; the
    // bed's event one-shots deliberately do not gate and are not listed here).
    expect(roomAudioUrls('blockAfterDark', 'high', null)).toEqual([{ label: expect.any(String), url: PJS_BED_URL }]);
    expect(roomAudioUrls('blockAfterDark', 'high', 'the-pjs')).toEqual([{ label: expect.any(String), url: PJS_BED_URL }]);
    expect(roomAudioUrls('blockAfterDark', 'high', 'king')).toEqual([]);
    expect(roomAudioUrls('blockAfterDark', 'low', null)).toEqual([]);
    expect(roomAudioUrls('blockAfterDark', 'low', 'the-pjs')).toEqual([]);
    expect(roomAudioUrls('speakeasy', 'high', null)).toEqual([]);
    expect(roomAudioUrls('speakeasy', 'high', 'corner')).toEqual([]);
    expect(existsSync(new URL('../public/audio/ambience/pjs-night-street.mp3', import.meta.url))).toBe(true);
    // The engine fetches the same file the gate waits on (audio.ts carries its own
    // copy of the URL — the two literals must never drift apart).
    const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
    expect(audio).toContain(`const PJS_BED_URL = '${PJS_BED_URL}'`);
  });

  it('the gate sedan URL is the very file PjsStreetRoom loads', () => {
    const src = readFileSync(new URL('../src/three/PjsStreetRoom.tsx', import.meta.url), 'utf8');
    expect(src).toContain(`const SEDAN_URL = '${SEDAN_GLB_URL}'`);
    const corner = readFileSync(new URL('../src/three/CornerStreetRoom.tsx', import.meta.url), 'utf8');
    expect(corner).toContain("SEDAN_URL } from './PjsStreetRoom'");
  });

  it('the ledger collects noted room files per venue, deduped', () => {
    noteRoomAssets('ledger-test-venue', ['/a.jpg', '/b.glb']);
    noteRoomAssets('ledger-test-venue', ['/a.jpg', '/c.jpg']);
    expect(notedRoomAssets('ledger-test-venue')).toEqual(['/a.jpg', '/b.glb', '/c.jpg']);
    expect(notedRoomAssets('never-noted-venue')).toEqual([]);
  });

  it('every three-layer warm pass notes its files into the ledger', () => {
    const venue3d = readFileSync(new URL('../src/three/Venue3D.tsx', import.meta.url), 'utf8');
    expect(venue3d).toContain('noteRoomAssets(id,');
    const cube = readFileSync(new URL('../src/three/cubeVenue.tsx', import.meta.url), 'utf8');
    expect(cube).toContain('noteRoomAssets(cfg.id, files)');
    const barber = readFileSync(new URL('../src/three/BarbershopRoom.tsx', import.meta.url), 'utf8');
    expect(barber).toContain("noteRoomAssets('barbershop', files)");
    const classic = readFileSync(new URL('../src/three/ClassicStudio.tsx', import.meta.url), 'utf8');
    expect(classic).toContain("noteRoomAssets('classic', files)");
  });

  it('Table wires the gate into the loader dismissal', () => {
    const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    expect(table).toContain('loaderStillUp({ dressed, effectsWarm, assetsSettled, giveUp: loadGiveUp })');
    expect(table).toContain('createAssetGate(');
    expect(table).toContain('whenDeckArtSettled(settings.deck)');
    expect(table).toContain('whenDeckBackSettled(settings.deck)');
    expect(table).toContain('__bwmAssetGate');
  });
});

describe('story seam gate composition (owner 2026-10-28: Rec assets never arriving)', () => {
  // The seam tables: High only — one row per seam branch in Scene.tsx.
  // SEAMS is stop-keyed (the bespoke room mounts only on a table carrying
  // its story stop). VENUE_WIDE_SEAMS is venue-keyed: the venues rollout
  // (Batches A–B, 2026-10-28) un-scoped those rooms to every High table at the
  // venue, so the ledger skip follows the room, not the story flag.
  // VENUE_ROOMS (Batch C1) is the second venue-keyed shape: the story room
  // is a different place and stays stop-keyed with Scene priority (the
  // Corner street, the Porch deck), while a NEW bespoke room built for the
  // venue itself (the Speakeasy Lounge, Grandma's Kitchen) mounts for
  // every non-story High table — both High branches are all-code, so the
  // ledger skip holds venue-wide at High and Low keeps the ledger.
  // blockAfterDark's one seam is the king stop, whose branch lives in
  // Venue3D (the King's Lounge replaces the street room there); the Pj's
  // street room is the venue room for story Stop 9 and open tables alike.
  // NO_STORY_VENUE_ROOMS (Batch C2) is the third venue-keyed shape:
  // yacht/beach host no stops at all — no stop-keyed row, no story
  // branch — and their NEW bespoke rooms (the Yacht Deck, the Beach
  // Cabana) mount for every High table, all-code, so the ledger skip
  // holds venue-wide at High and Low keeps the ledger.
  // Batch C3 (rooftop + vegas) extends VENUE_ROOMS: their story
  // rooms (RooftopDuskRoom, LegendsTableRoom) are different rooms
  // and stay stop-keyed with priority, while the venues' own NEW
  // rooms (Rooftop Skyline, Vegas Casino Floor) mount for every
  // non-story High table — the same ledger skip, Low unchanged.
  const SEAMS: [string, string][] = [
    ['classic', 'rec-center'],
  ];
  // [venue, its story stop, the Scene branch's venue flag]
  const VENUE_WIDE_SEAMS: [string, string, string][] = [
    ['barbershop', 'barbershop', 'barbershop'],
    ['backyard', 'cookout', 'backyard'],
    ['church', 'church-basement', 'church'],
    ['mansion', 'high-rise', 'mansion'],
  ];
  // [venue, its story stop, the Scene branch's venue flag, the new room]
  const VENUE_ROOMS: [string, string, string, string][] = [
    ['speakeasy', 'corner', 'speakeasy', 'SpeakeasyLoungeRoom'],
    ['grandma', 'porch', 'grandma', 'GrandmasKitchenRoom'],
    // Batch C3: same shape — the story rooms (RooftopDuskRoom,
    // LegendsTableRoom) are different rooms and stay stop-keyed
    // with priority, while the venues' own new rooms (the
    // Rooftop Skyline, the Vegas Casino Floor) mount for every
    // non-story High table.
    ['rooftop', 'rooftop', 'rooftop', 'RooftopSkylineRoom'],
    ['vegas', 'legends', 'vegas', 'VegasCasinoRoom'],
  ];
  // [venue, the Scene branch's venue flag, the new room] — no story stop
  const NO_STORY_VENUE_ROOMS: [string, string, string][] = [
    ['yacht', 'yacht', 'YachtDeckRoom'],
    ['beach', 'beach', 'BeachCabanaRoom'],
  ];

  it('every shipped story seam mounts at High, and only at High', () => {
    for (const [venue, stop] of SEAMS) {
      expect(storySeamMounts(venue, 'high', stop)).toBe(true);
      // Low mounts the venue fallback room — its ledger files are used there.
      expect(storySeamMounts(venue, 'low', stop)).toBe(false);
    }
  });

  it('venue-wide seams mount at High for every table at the venue, story or not', () => {
    for (const [venue, stop] of VENUE_WIDE_SEAMS) {
      expect(storySeamMounts(venue, 'high', stop)).toBe(true);
      // A regular table (no stop) and even a mismatched stop still mount
      // the venue's room — the Scene branch no longer reads the stop.
      expect(storySeamMounts(venue, 'high', null)).toBe(true);
      expect(storySeamMounts(venue, 'high', 'rec-center')).toBe(true);
      // Low mounts the venue fallback room — its ledger files are used there.
      expect(storySeamMounts(venue, 'low', stop)).toBe(false);
      expect(storySeamMounts(venue, 'low', null)).toBe(false);
    }
  });

  it('venue rooms (Batch C1) skip the ledger at High for story and regular tables alike', () => {
    for (const [venue, stop] of VENUE_ROOMS) {
      // the story table: its stop-keyed room mounts (Corner / Porch)
      expect(storySeamMounts(venue, 'high', stop)).toBe(true);
      // the regular table: the venue's own new room mounts
      expect(storySeamMounts(venue, 'high', null)).toBe(true);
      // a mismatched stop cannot occur (stops bind to their venue);
      // if one ever arrived, the venue room — not the fallback —
      // is what Scene's branch would mount, so the skip is honest
      expect(storySeamMounts(venue, 'high', 'rec-center')).toBe(true);
      // Low mounts the cube fallback — its ledger files are used there
      expect(storySeamMounts(venue, 'low', stop)).toBe(false);
      expect(storySeamMounts(venue, 'low', null)).toBe(false);
      expect(gateLedgerVenue(venue, 'high', stop)).toBeNull();
      expect(gateLedgerVenue(venue, 'high', null)).toBeNull();
      expect(gateLedgerVenue(venue, 'low', null)).toBe(venue);
    }
  });

  it('venue rooms with no story stop (Batch C2) skip the ledger at High for every table', () => {
    for (const [venue] of NO_STORY_VENUE_ROOMS) {
      // every High table at the venue mounts the bespoke room — the
      // branch never reads a stop, so any stop value composes the same
      expect(storySeamMounts(venue, 'high', null)).toBe(true);
      expect(storySeamMounts(venue, 'high', 'rec-center')).toBe(true);
      // Low mounts the cube fallback — its ledger files are used there
      expect(storySeamMounts(venue, 'low', null)).toBe(false);
      expect(gateLedgerVenue(venue, 'high', null)).toBeNull();
      expect(gateLedgerVenue(venue, 'low', null)).toBe(venue);
    }
  });

  it('non-story tables and mismatched pairs never count as seams', () => {
    for (const [venue] of SEAMS) expect(storySeamMounts(venue, 'high', null)).toBe(false);
    expect(storySeamMounts('classic', 'high', 'porch')).toBe(false);
    // The street tables: no seam at Stop 9 or open — the sedan keeps riding
    // roomGlbUrls there. (The king stop IS a seam — pinned below.)
    expect(storySeamMounts('blockAfterDark', 'high', 'pjs')).toBe(false);
    expect(storySeamMounts('blockAfterDark', 'high', null)).toBe(false);
  });

  it('the seam table stays in sync with Scene.tsx seam branches', () => {
    const scene = readFileSync(new URL('../src/three/Scene.tsx', import.meta.url), 'utf8');
    for (const [venue, stop] of SEAMS) {
      expect(scene).toContain(`def.id === '${venue}'`);
      expect(scene).toContain(`props.storyStopId === '${stop}' && props.quality === 'high'`);
    }
    for (const [venue, stop, flag] of VENUE_WIDE_SEAMS) {
      expect(scene).toContain(`def.id === '${venue}'`);
      expect(scene).toContain(`{${flag} && textured && (props.quality === 'high'`);
      expect(scene).not.toContain(`props.storyStopId === '${stop}'`);
    }
    for (const [venue, stop, flag, room] of VENUE_ROOMS) {
      expect(scene).toContain(`def.id === '${venue}'`);
      // the story term SURVIVES here (unlike the un-scoped rooms):
      // the story branch keeps priority inside the same Scene branch
      expect(scene).toContain(`{${flag} && textured && (props.storyStopId === '${stop}' && props.quality === 'high'`);
      // the mount opens with the fxOn prop (the Rooftop Skyline
      // also takes handNo for its TOD lock — pinned in its own suite)
      expect(scene).toContain(`<${room} fxOn={!props.reduceFx}`);
    }
    for (const [venue, flag, room] of NO_STORY_VENUE_ROOMS) {
      expect(scene).toContain(`def.id === '${venue}'`);
      // no story term: the venue's own room mounts at High, the cube
      // room keeps Low — the same mount shape as the un-scoped rooms
      expect(scene).toContain(`{${flag} && textured && (props.quality === 'high'`);
      expect(scene).toContain(`<${room} fxOn={!props.reduceFx} />`);
    }
  });

  it('the sedan stays gated at the street tables via roomGlbUrls — but not at the king', () => {
    // The King's Lounge (story, stop king, High) is the Classic Studio cube:
    // it loads no sedan and no street file (its GLBs/textures are the studio
    // set, which rides the classic ledger via gateLedgerVenue). Stop 9
    // (the-pjs), open blockAfterDark tables and the Corner keep the sedan.
    expect(roomGlbUrls('blockAfterDark', 'high', 'king')).toEqual([]);
    expect(roomGlbUrls('blockAfterDark', 'low', 'king')).toEqual([]);
    expect(roomGlbUrls('blockAfterDark', 'high', 'the-pjs')).toEqual([{ label: expect.any(String), url: SEDAN_GLB_URL }]);
    expect(roomGlbUrls('blockAfterDark', 'high', null)).toEqual([{ label: expect.any(String), url: SEDAN_GLB_URL }]);
    expect(roomGlbUrls('speakeasy', 'high', 'corner')).toEqual([
      { label: expect.any(String), url: SEDAN_GLB_URL },
      { label: expect.any(String), url: '/assets/figures/dee.glb' },
      { label: expect.any(String), url: '/assets/figures/smoke.glb' },
      { label: expect.any(String), url: '/assets/figures/redd.glb' },
    ]);
  });

  it("the king seam mounts at High only, in sync with Venue3D's lounge branch", () => {
    expect(storySeamMounts('blockAfterDark', 'high', 'king')).toBe(true);
    expect(storySeamMounts('blockAfterDark', 'low', 'king')).toBe(false);
    const venue3d = readFileSync(new URL('../src/three/Venue3D.tsx', import.meta.url), 'utf8');
    expect(venue3d).toContain("storyStopId === 'king' && quality === 'high'");
  });

  it('gateLedgerVenue: no ledger at a seam, the classic ledger at the king seam', () => {
    for (const [venue, stop] of SEAMS) {
      expect(gateLedgerVenue(venue, 'high', stop)).toBeNull();
      expect(gateLedgerVenue(venue, 'low', stop)).toBe(venue);
    }
    for (const [venue, stop] of VENUE_WIDE_SEAMS) {
      expect(gateLedgerVenue(venue, 'high', stop)).toBeNull();
      expect(gateLedgerVenue(venue, 'high', null)).toBeNull();
      expect(gateLedgerVenue(venue, 'low', stop)).toBe(venue);
    }
    expect(gateLedgerVenue('blockAfterDark', 'high', 'king')).toBe('classic');
    expect(gateLedgerVenue('blockAfterDark', 'low', 'king')).toBe('blockAfterDark');
    expect(gateLedgerVenue('blockAfterDark', 'high', 'the-pjs')).toBe('blockAfterDark');
    expect(gateLedgerVenue('classic', 'high', null)).toBe('classic');
  });

  // Table's registration sequence, modelled on its gate effect: the deck in
  // use (group + back) and the seated story portraits register directly; the
  // venue ledger folds in last, behind the seam check — through
  // gateLedgerFiles, so a Low fold drops the files only High ever loads
  // (Batch D: the GLB props and the Barbershop videos; see the Batch D
  // describe below). The Rec table's real counts: 5 direct units (deck
  // group, back, Dee + two opponent portraits) and the Classic Studio's
  // 5 ledger files.
  const STUDIO_FILES = [
    '/assets/venues/classic/chair.glb',
    '/assets/venues/classic/lamp.glb',
    '/assets/venues/classic/floor_diffuse_512.jpg',
    '/assets/venues/classic/floor_nor_gl_512.jpg',
    '/assets/venues/classic/floor_rough_512.jpg',
  ];
  const composeGate = (venue: string, quality: 'high' | 'low', stopId: string | null) => {
    const gate = createAssetGate(`${quality}:${venue}:blacktop:${stopId ?? 'open'}`, 60_000);
    gate.addGroup('deck art (blacktop)', Promise.resolve({ failed: [] as string[] }));
    gate.add('card back (blacktop)', Promise.resolve(true));
    for (const p of ['dee', 'lil-man', 'trey']) gate.add(`/assets/story/faces/${p}.webp`, Promise.resolve(true));
    const ledgerVenue = gateLedgerVenue(venue, quality, stopId);
    if (ledgerVenue !== null) {
      for (const url of gateLedgerFiles(ledgerVenue, quality)) gate.add(url, Promise.resolve(true));
    }
    gate.seal();
    return gate;
  };

  it('story seam at High: the venue ledger is excluded, deck/back/portraits stay (Rec 10 → 5)', async () => {
    noteRoomAssets('classic', STUDIO_FILES);
    const r = await composeGate('classic', 'high', 'rec-center').done;
    expect(r.total).toBe(5);
    expect(r.settled).toBe(5);
    expect(r.cappedOut).toBe(false);
    expect(r.pendingAtCap).toEqual([]);
    expect(r.failed).toEqual([]);
  });

  it('story seam at Low: the venue ledger folds in, minus the High-only GLBs (Batch D)', async () => {
    noteRoomAssets('classic', STUDIO_FILES);
    const r = await composeGate('classic', 'low', 'rec-center').done;
    // 5 direct + the studio's 3 floor maps; the chair/lamp GLBs are
    // High-only loads, so a Low gate no longer waits on them.
    expect(r.total).toBe(8);
    expect(r.cappedOut).toBe(false);
  });

  it('non-story table: the venue ledger folds in exactly as before', async () => {
    noteRoomAssets('classic', STUDIO_FILES);
    const r = await composeGate('classic', 'high', null).done;
    expect(r.total).toBe(10);
    expect(r.cappedOut).toBe(false);
  });

  // The venues rollout (Batches A–B un-scope): at barbershop / backyard /
  // church / mansion the bespoke all-code room now mounts for EVERY High table, so a
  // regular High table's gate must equal the story composition — the
  // fallback room's ledger (its chair/lamp GLBs, floor, posters, video) is
  // excluded or the Rec defect reappears at regular tables. Low mounts the
  // fallback, so the ledger folds in there (Batch D: minus the files
  // only High ever loads — gateLedgerFiles).
  const BARBER_FILES = [
    '/assets/venues/classic/chair.glb',
    '/assets/venues/classic/lamp.glb',
    '/assets/venues/barbershop/room/sky-poster.jpg',
    '/assets/venues/barbershop/room/street-poster.jpg',
    '/assets/venues/barbershop/room/sky-day.webm',
    '/assets/venues/barbershop/room/street.webm',
  ];
  const BACKYARD_FILES = [
    '/assets/venues/classic/chair.glb',
    '/assets/venues/tex/leafy_grass_512.jpg',
    '/assets/venues/barbershop/room/sky-poster.jpg',
  ];
  const CHURCH_FILES = [
    '/assets/venues/classic/chair.glb',
    '/assets/venues/tex/old_linoleum_flooring_01_512.jpg',
    '/assets/venues/barbershop/room/sky-poster.jpg',
  ];

  it('venue-wide seam at regular High: the venue ledger is excluded (barbershop 11 → 5)', async () => {
    noteRoomAssets('barbershop', BARBER_FILES);
    const r = await composeGate('barbershop', 'high', null).done;
    expect(r.total).toBe(5);
    expect(r.cappedOut).toBe(false);
    // The story table at the same venue composes identically.
    const s = await composeGate('barbershop', 'high', 'barbershop').done;
    expect(s.total).toBe(5);
  });

  it('venue-wide seam at Low: only the files Low mounts fold in (Batch D)', async () => {
    noteRoomAssets('barbershop', BARBER_FILES);
    const r = await composeGate('barbershop', 'low', null).done;
    // 5 direct + the 2 poster plates; the GLB props and the sky/street
    // videos are High-only loads (Low takes the poster branch).
    expect(r.total).toBe(7);
    expect(r.cappedOut).toBe(false);
  });

  it('venue-wide seam at regular High: the venue ledger is excluded (backyard 8 → 5)', async () => {
    noteRoomAssets('backyard', BACKYARD_FILES);
    const r = await composeGate('backyard', 'high', null).done;
    expect(r.total).toBe(5);
    expect(r.cappedOut).toBe(false);
    const l = await composeGate('backyard', 'low', null).done;
    expect(l.total).toBe(7); // Batch D: the chair GLB no longer folds at Low
  });

  it('venue-wide seam at regular High: the venue ledger is excluded (church 8 → 5)', async () => {
    noteRoomAssets('church', CHURCH_FILES);
    const r = await composeGate('church', 'high', null).done;
    expect(r.total).toBe(5);
    expect(r.cappedOut).toBe(false);
    const l = await composeGate('church', 'low', null).done;
    expect(l.total).toBe(7); // Batch D: the chair GLB no longer folds at Low
  });

  // Batch B: the mansion ledger is what preloadCubeVenue(MANSION) notes —
  // the shared chair/lamp GLBs, the marble floor file, the sky poster.
  const MANSION_FILES = [
    '/assets/venues/classic/chair.glb',
    '/assets/venues/classic/lamp.glb',
    '/assets/venues/tex/marble_tiles_512.jpg',
    '/assets/venues/barbershop/room/sky-poster.jpg',
  ];

  it('venue-wide seam at regular High: the venue ledger is excluded (mansion 9 → 5)', async () => {
    noteRoomAssets('mansion', MANSION_FILES);
    const r = await composeGate('mansion', 'high', null).done;
    expect(r.total).toBe(5);
    expect(r.cappedOut).toBe(false);
    // The high-rise story table at the same venue composes identically.
    const s = await composeGate('mansion', 'high', 'high-rise').done;
    expect(s.total).toBe(5);
    const l = await composeGate('mansion', 'low', null).done;
    expect(l.total).toBe(7); // Batch D: the chair/lamp GLBs no longer fold at Low
  });

  // Batch C1: the speakeasy ledger is what preloadCubeVenue(SPEAKEASY)
  // notes — the shared chair/lamp GLBs and the herringbone floor file.
  // The cube room used them at High; the all-code Lounge never requests
  // them, so a regular High table's gate must equal the story
  // composition (the Corner's sedan still rides roomGlbUrls, pinned
  // above — it is not a ledger file). Low mounts the cube room, so the
  // ledger folds in there (Batch D: minus the High-only files).
  const SPEAKEASY_FILES = [
    '/assets/venues/classic/chair.glb',
    '/assets/venues/classic/lamp.glb',
    '/assets/venues/tex/herringbone_parquet_512.jpg',
  ];

  it('venue room at regular High: the venue ledger is excluded (speakeasy 8 → 5)', async () => {
    noteRoomAssets('speakeasy', SPEAKEASY_FILES);
    const r = await composeGate('speakeasy', 'high', null).done;
    expect(r.total).toBe(5);
    expect(r.cappedOut).toBe(false);
    // The corner story table at the same venue composes identically
    // (its seated figures — Batch 2: Dee + Smoke + Redd — ride
    // roomGlbUrls like the sedan, pinned above; not ledger files).
    const s = await composeGate('speakeasy', 'high', 'corner').done;
    expect(s.total).toBe(5);
    const l = await composeGate('speakeasy', 'low', null).done;
    expect(l.total).toBe(6); // Batch D: only the herringbone floor folds at Low
  });

  // Batch C1: the grandma ledger is what preloadCubeVenue(GRANDMA)
  // notes — the shared chair/lamp GLBs, the linoleum floor file, and
  // the sky poster. The all-code Kitchen never requests them; the
  // Porch story room is procedural too, so story tables already
  // composed at 5 — regular High tables now match them.
  const GRANDMA_FILES = [
    '/assets/venues/classic/chair.glb',
    '/assets/venues/classic/lamp.glb',
    '/assets/venues/tex/linoleum_brown_512.jpg',
    '/assets/venues/barbershop/room/sky-poster.jpg',
  ];

  it("venue room at regular High: the venue ledger is excluded (grandma 9 → 5)", async () => {
    noteRoomAssets('grandma', GRANDMA_FILES);
    const r = await composeGate('grandma', 'high', null).done;
    expect(r.total).toBe(5);
    expect(r.cappedOut).toBe(false);
    // The porch story table at the same venue composes identically.
    const s = await composeGate('grandma', 'high', 'porch').done;
    expect(s.total).toBe(5);
    const l = await composeGate('grandma', 'low', null).done;
    expect(l.total).toBe(7); // Batch D: the chair/lamp GLBs no longer fold at Low
  });

  // Batch C2: the yacht ledger is what preloadCubeVenue(YACHT) notes —
  // the shared chair GLB, the deck floor file, and the sky poster (no
  // lamp: the cube config has no pendants). The all-code Yacht Deck
  // never requests them, so a regular High table's gate excludes them;
  // Low mounts the cube room, so the ledger folds in there (Batch D:
  // minus the High-only files).
  const YACHT_FILES = [
    '/assets/venues/classic/chair.glb',
    '/assets/venues/tex/wood_floor_deck_512.jpg',
    '/assets/venues/barbershop/room/sky-poster.jpg',
  ];

  it('venue room at regular High: the venue ledger is excluded (yacht 8 → 5)', async () => {
    noteRoomAssets('yacht', YACHT_FILES);
    const r = await composeGate('yacht', 'high', null).done;
    expect(r.total).toBe(5);
    expect(r.cappedOut).toBe(false);
    const l = await composeGate('yacht', 'low', null).done;
    expect(l.total).toBe(7); // Batch D: the chair GLB no longer folds at Low
  });

  // Batch C2: the beach ledger is what preloadCubeVenue(BEACH) notes —
  // the shared chair GLB, the sand floor file, and the sky poster.
  const BEACH_FILES = [
    '/assets/venues/classic/chair.glb',
    '/assets/venues/tex/coast_sand_01_512.jpg',
    '/assets/venues/barbershop/room/sky-poster.jpg',
  ];

  it('venue room at regular High: the venue ledger is excluded (beach 8 → 5)', async () => {
    noteRoomAssets('beach', BEACH_FILES);
    const r = await composeGate('beach', 'high', null).done;
    expect(r.total).toBe(5);
    expect(r.cappedOut).toBe(false);
    const l = await composeGate('beach', 'low', null).done;
    expect(l.total).toBe(7); // Batch D: the chair GLB no longer folds at Low
  });

  // Batch C3: the rooftop ledger is what preloadCubeVenue(ROOFTOP)
  // notes — the shared chair GLB, the brushed-concrete floor
  // file, and the sky poster (no lamp: the cube config has no
  // pendants). The all-code Rooftop Skyline never requests
  // them; the dusk story room is procedural too, so story
  // tables already composed at 5 — regular High tables now
  // match them, and Low mounts the cube room as before.
  const ROOFTOP_FILES = [
    '/assets/venues/classic/chair.glb',
    '/assets/venues/tex/brushed_concrete_512.jpg',
    '/assets/venues/barbershop/room/sky-poster.jpg',
  ];

  it('venue room at regular High: the venue ledger is excluded (rooftop 8 → 5)', async () => {
    noteRoomAssets('rooftop', ROOFTOP_FILES);
    const r = await composeGate('rooftop', 'high', null).done;
    expect(r.total).toBe(5);
    expect(r.cappedOut).toBe(false);
    // The rooftop story table at the same venue composes identically.
    const s = await composeGate('rooftop', 'high', 'rooftop').done;
    expect(s.total).toBe(5);
    const l = await composeGate('rooftop', 'low', null).done;
    expect(l.total).toBe(7); // Batch D: the chair GLB no longer folds at Low
  });

  // Batch C3: the vegas ledger is what preloadCubeVenue(VEGAS)
  // notes — the shared chair/lamp GLBs and the dirty-carpet
  // floor file. The all-code Casino Floor never requests
  // them; the Legends story room is procedural too, so story
  // tables already composed at 5 — regular High tables now
  // match them, and Low mounts the cube room as before.
  const VEGAS_FILES = [
    '/assets/venues/classic/chair.glb',
    '/assets/venues/classic/lamp.glb',
    '/assets/venues/tex/dirty_carpet_512.jpg',
  ];

  it('venue room at regular High: the venue ledger is excluded (vegas 8 → 5)', async () => {
    noteRoomAssets('vegas', VEGAS_FILES);
    const r = await composeGate('vegas', 'high', null).done;
    expect(r.total).toBe(5);
    expect(r.cappedOut).toBe(false);
    // The legends story table at the same venue composes identically.
    const s = await composeGate('vegas', 'high', 'legends').done;
    expect(s.total).toBe(5);
    const l = await composeGate('vegas', 'low', null).done;
    expect(l.total).toBe(6); // Batch D: only the dirty-carpet floor folds at Low
  });

  it('king at High: the studio ledger rides the gate, the street ledger and sedan do not', async () => {
    noteRoomAssets('classic', STUDIO_FILES);
    noteRoomAssets('blockAfterDark', [
      '/assets/venues/blockAfterDark/bg.jpg',
      '/assets/venues/blockAfterDark/sedan.glb',
    ]);
    const r = await composeGate('blockAfterDark', 'high', 'king').done;
    // 5 direct + the 5 classic studio files the lounge actually loads.
    expect(r.total).toBe(10);
    expect(r.cappedOut).toBe(false);
    expect(r.pendingAtCap).toEqual([]);
  });

  it('stop 9 (the-pjs) at High: the street ledger still rides the gate', async () => {
    noteRoomAssets('blockAfterDark', [
      '/assets/venues/blockAfterDark/bg.jpg',
      '/assets/venues/blockAfterDark/sedan.glb',
    ]);
    const r = await composeGate('blockAfterDark', 'high', 'the-pjs').done;
    expect(r.total).toBe(7);
    expect(r.cappedOut).toBe(false);
  });

  it('Table applies the seam check at the fold-in and publishes pendingAtCap on the probe', () => {
    const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    expect(table).toContain('gateLedgerVenue(venue, settings.quality, stopId)');
    expect(table).toContain('preloadTableAssets(settings.quality, venue, stopId)');
    expect(table).toContain('pendingAtCap: r.pendingAtCap');
    expect(table).toContain('pendingAtCap: extra.pendingAtCap');
  });
});

describe('Batch D: the Low fold (venues rollout certification sweep, 2026-10-29)', () => {
  // Verified from the mount code: at Low, CubeVenueRoom / ClassicStudio /
  // BarbershopRoom never load their GLB props (their prop effects return
  // early unless High), BarbershopRoom never creates its sky/street video
  // elements (it takes the poster branch), and the Pj's mounts backdrop +
  // floor disc + PjsLife — never the sedan. Floor textures, posters and
  // the backdrop/floor/HDRI sets DO load at Low and stay gated.
  it('gateLedgerFiles drops model/video files at Low and nothing else', () => {
    noteRoomAssets('batchd-unit', [
      '/assets/venues/classic/chair.glb',
      '/assets/venues/classic/lamp.glb',
      '/assets/venues/blockAfterDark/sedan.glb',
      '/assets/venues/barbershop/room/sky-day.webm',
      '/assets/venues/barbershop/room/street.webm',
      '/assets/venues/tex/marble_tiles_512.jpg',
      '/assets/venues/barbershop/room/sky-poster.jpg',
      '/assets/venues/x/env.hdr',
    ]);
    expect(gateLedgerFiles('batchd-unit', 'low')).toEqual([
      '/assets/venues/tex/marble_tiles_512.jpg',
      '/assets/venues/barbershop/room/sky-poster.jpg',
      '/assets/venues/x/env.hdr',
    ]);
    expect(gateLedgerFiles('batchd-unit', 'high')).toHaveLength(8);
    expect(gateLedgerFiles('never-noted-venue', 'low')).toEqual([]);
  });

  it('Table folds through gateLedgerFiles, and the warm passes note quality-aware', () => {
    const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    expect(table).toContain('gateLedgerFiles(ledgerVenue, settings.quality)');
    const cube = readFileSync(new URL('../src/three/cubeVenue.tsx', import.meta.url), 'utf8');
    expect(cube).toContain("preloadCubeVenue(cfg: CubeVenueConfig, quality: 'high' | 'low' = 'high')");
    expect(cube).toContain("quality === 'high' ? [`${CLASSIC}/chair.glb`");
    const classic = readFileSync(new URL('../src/three/ClassicStudio.tsx', import.meta.url), 'utf8');
    expect(classic).toContain("preloadClassicStudio(quality: 'high' | 'low' = 'high')");
    expect(classic).toContain("quality === 'high' ? [`${BASE}/chair.glb`, `${BASE}/lamp.glb`]");
    const barber = readFileSync(new URL('../src/three/BarbershopRoom.tsx', import.meta.url), 'utf8');
    expect(barber).toContain("preloadBarbershopRoom(quality: 'high' | 'low' = 'high')");
    expect(barber).toContain(': [BARBER_ASSETS.skyPoster, BARBER_ASSETS.streetPoster];');
    const scene = readFileSync(new URL('../src/three/Scene.tsx', import.meta.url), 'utf8');
    expect(scene).toContain('preloadBarbershopRoom(quality)');
    expect(scene).toContain('preloadClassicStudio(quality)');
    expect(scene).toContain('preloadBackyardRoom(quality)');
  });

  // THE CLOSING TABLE — regular-play gate composition for all 12 venues,
  // on this suite's model (5 direct units: deck group, card back, three
  // seated portraits; Table's venue-direct files ride on top in the app).
  // Each venue's ledger is noted with its FULL High list — the mixed
  // session a Low table can inherit — and the Low fold must still land
  // on exactly the files its fallback room mounts.
  //   venue          High (open table)   Low (open table)   Low folds
  //   classic        10 (5 + 5 ledger)    8 (5 + 3)          floor PBR set
  //   barbershop      5 (seam skip)       7 (5 + 2)          sky/street posters
  //   backyard        5 (seam skip)       7 (5 + 2)          grass floor, sky poster
  //   church          5 (seam skip)       7 (5 + 2)          linoleum, sky poster
  //   mansion         5 (seam skip)       7 (5 + 2)          marble, sky poster
  //   speakeasy       5 (seam skip)       6 (5 + 1)          herringbone floor
  //   grandma         5 (seam skip)       7 (5 + 2)          linoleum, sky poster
  //   yacht           5 (seam skip)       7 (5 + 2)          deck floor, sky poster
  //   beach           5 (seam skip)       7 (5 + 2)          sand floor, sky poster
  //   rooftop         5 (seam skip)       7 (5 + 2)          concrete, sky poster
  //   vegas           5 (seam skip)       6 (5 + 1)          dirty-carpet floor
  //   blockAfterDark  8 (5 + 3 ledger)    7 (5 + 2)          backdrop, street floor
  const composeOpen = (venue: string, quality: 'high' | 'low') => {
    const gate = createAssetGate(`${quality}:${venue}:blacktop:open`, 60_000);
    gate.addGroup('deck art (blacktop)', Promise.resolve({ failed: [] as string[] }));
    gate.add('card back (blacktop)', Promise.resolve(true));
    for (const p of ['dee', 'lil-man', 'trey']) gate.add(`/assets/story/faces/${p}.webp`, Promise.resolve(true));
    const ledgerVenue = gateLedgerVenue(venue, quality, null);
    if (ledgerVenue !== null) {
      for (const url of gateLedgerFiles(ledgerVenue, quality)) gate.add(url, Promise.resolve(true));
    }
    gate.seal();
    return gate;
  };
  const LOW_TABLE: [string, string[], number][] = [
    ['classic', ['/assets/venues/classic/chair.glb', '/assets/venues/classic/lamp.glb', '/assets/venues/classic/floor_diffuse_512.jpg', '/assets/venues/classic/floor_nor_gl_512.jpg', '/assets/venues/classic/floor_rough_512.jpg'], 8],
    ['barbershop', ['/assets/venues/classic/chair.glb', '/assets/venues/classic/lamp.glb', '/assets/venues/barbershop/room/sky-poster.jpg', '/assets/venues/barbershop/room/street-poster.jpg', '/assets/venues/barbershop/room/sky-day.webm', '/assets/venues/barbershop/room/street.webm'], 7],
    ['backyard', ['/assets/venues/classic/chair.glb', '/assets/venues/tex/leafy_grass_512.jpg', '/assets/venues/barbershop/room/sky-poster.jpg'], 7],
    ['church', ['/assets/venues/classic/chair.glb', '/assets/venues/tex/old_linoleum_flooring_01_512.jpg', '/assets/venues/barbershop/room/sky-poster.jpg'], 7],
    ['mansion', ['/assets/venues/classic/chair.glb', '/assets/venues/classic/lamp.glb', '/assets/venues/tex/marble_tiles_512.jpg', '/assets/venues/barbershop/room/sky-poster.jpg'], 7],
    ['speakeasy', ['/assets/venues/classic/chair.glb', '/assets/venues/classic/lamp.glb', '/assets/venues/tex/herringbone_parquet_512.jpg'], 6],
    ['grandma', ['/assets/venues/classic/chair.glb', '/assets/venues/classic/lamp.glb', '/assets/venues/tex/linoleum_brown_512.jpg', '/assets/venues/barbershop/room/sky-poster.jpg'], 7],
    ['yacht', ['/assets/venues/classic/chair.glb', '/assets/venues/tex/wood_floor_deck_512.jpg', '/assets/venues/barbershop/room/sky-poster.jpg'], 7],
    ['beach', ['/assets/venues/classic/chair.glb', '/assets/venues/tex/coast_sand_01_512.jpg', '/assets/venues/barbershop/room/sky-poster.jpg'], 7],
    ['rooftop', ['/assets/venues/classic/chair.glb', '/assets/venues/tex/brushed_concrete_512.jpg', '/assets/venues/barbershop/room/sky-poster.jpg'], 7],
    ['vegas', ['/assets/venues/classic/chair.glb', '/assets/venues/classic/lamp.glb', '/assets/venues/tex/dirty_carpet_512.jpg'], 6],
    ['blockAfterDark', ['/assets/venues/blockAfterDark/bg.jpg', '/assets/venues/tex/brushed_concrete_512.jpg', '/assets/venues/blockAfterDark/sedan.glb'], 7],
  ];
  it('the closing table: every venue’s Low gate waits only on files Low mounts', async () => {
    for (const [venue, files, lowTotal] of LOW_TABLE) {
      noteRoomAssets(venue, files);
      const r = await composeOpen(venue, 'low').done;
      expect(r.total, `${venue} low`).toBe(lowTotal);
      expect(r.cappedOut).toBe(false);
    }
    // and the two non-seam High compositions the table rests on
    expect((await composeOpen('classic', 'high').done).total).toBe(10);
    expect((await composeOpen('blockAfterDark', 'high').done).total).toBe(8);
  });
});

/* A controllable Image: loads succeed unless the URL carries 'missing'. */
class FakeImage {
  complete = false;
  naturalWidth = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Set<() => void>>();
  private _src = '';
  set src(v: string) {
    this._src = v;
    queueMicrotask(() => {
      if (v.includes('missing')) {
        this.complete = true; this.naturalWidth = 0;
        this.onerror?.(); this.fire('error');
      } else {
        this.complete = true; this.naturalWidth = 12;
        this.onload?.(); this.fire('load');
      }
    });
  }
  get src() { return this._src; }
  addEventListener(type: string, fn: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: () => void) { this.listeners.get(type)?.delete(fn); }
  decode() { return Promise.resolve(); }
  private fire(type: string) { this.listeners.get(type)?.forEach((f) => f()); }
}

describe('deck settle helpers', () => {
  const realImage = globalThis.Image;
  afterEach(() => { globalThis.Image = realImage; });

  it('enumerates exactly the fetchable face set for the deck in use', () => {
    const classic = deckArtUrlsFor('classic');
    expect(classic).toHaveLength(14); // 12 courts + BJ + LJ; number cards are painted
    expect(classic).toContain('/assets/decks/classic/KS.jpg');
    expect(classic).toContain('/assets/decks/classic/JOKER-BIG.jpg');
    expect(classic).toContain('/assets/decks/classic/JOKER-LIL.jpg');
    const pjs = deckArtUrlsFor('pjs'); // Pj's Iron ships acesArt + webp
    expect(pjs).toHaveLength(18);
    expect(pjs).toContain('/assets/decks/pjs/AS.webp');
    expect(pjs.every((u) => u.endsWith('.webp'))).toBe(true);
  });

  it('the deck gate settles when the art lands, and warm art settles at once', async () => {
    globalThis.Image = FakeImage as unknown as typeof Image;
    const first = await whenDeckArtSettled('classic');
    expect(first).toEqual({ total: 14, failed: [] });
    const t0 = performance.now();
    const second = await whenDeckArtSettled('classic'); // fully cached: no artificial delay
    expect(performance.now() - t0).toBeLessThan(50);
    expect(second.failed).toEqual([]);
  });

  it('the card back settles, and a missing back resolves false instead of hanging', async () => {
    globalThis.Image = FakeImage as unknown as typeof Image;
    await expect(whenDeckBackSettled('classic')).resolves.toBe(true);
    // a deck id whose back URL misses: BACK_NAMES falls back to 'Base', so use
    // the image-level contract instead — a missing URL settles false.
    await expect(imageSettled('/assets/card-backs/missing-back.png')).resolves.toBe(false);
    await expect(imageSettled('/assets/card-backs/Base-back.png')).resolves.toBe(true);
  });
});
