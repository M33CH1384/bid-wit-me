import { RUN_SLAM_MS } from '../runIt';
import { Html } from '@react-three/drei';
import { Canvas, events as r3fEvents, useFrame, useThree } from '@react-three/fiber';
import { type ReactNode, type RefObject, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type BufferGeometry, type Camera, type Group, type Material, type Mesh, type Object3D, ACESFilmicToneMapping, AdditiveBlending, CanvasTexture, DataTexture, Matrix4, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, PCFSoftShadowMap, Quaternion, RepeatWrapping, Scene as ThreeScene, SRGBColorSpace, Texture, Vector2, Vector3 } from 'three';
import { type Card, type Play, type Trick } from '@spades/rules';
import Card3D, { createLitCardMaterial } from './Card3D';
import { departureSlot, handCardKey, handReactKey } from '../handOrder';
import { GAP_S, RAISE_SPREAD, spreadSeconds, cardIdFromHit, echoTap, fanGapPx, fanMotion, handCardChrome, handDepthOpts, handRenderOrder, hitsInPaintOrder, noteTapUp, pointerNdc, posePx, raiseLocalY, raiseSpreadPx, spreadFitScale } from './handLift';
import { type HandHitCard, pickHandCard, publishHandHits, publishedHandHits } from './handHit';
import { paintFace } from '../cardArt';
import { dragStarted, dropResult } from '../dragPlay';
import { DEFAULT_SLAM, type DragSample, clearDrop, dragSlamIntensity, noteDrop, releaseVector, releaseVelocity, slamFeel, slamIntensity, takeDrop } from '../slam';
import { reducedMotion } from './handLift';
import { VISIBLE_FELT, landTrick, playSeed, runScatter } from './landing';
import { shakeOffset, swayOffset } from './shake';
import { isShortLandscape } from '../viewport';
import { type DealTimeline, dealTimeline, seatDealDelay } from './dealTimeline';
import { dealHeld, handDealsIn, handOnFan, handSlotKey } from './dealFlight';
import { cardShowsFace, flatFanHidden, handLatched, latchHand, resumeDrawList, showResumeHand3D, visibleFaceIds } from './cardFace';
import { openingTrickKeys, trickCardLaunches, trickPlayFrom } from './trickFacing';
import { type Sfx, sound } from '../audio';
import { fx } from '../fx';
import { backTexture, faceTexture, logoTexture, peekFaceTexture, refreshFacesGradually } from './cardTextures';
import { loadTableImage, prefetchTableTextures, tableTextureUrls } from '../tableAssets';
import { ClassicHall } from './hallEnv';
import { forceProgram, nextFrame, quietShaderErrors } from './shaderBudget';
import { importChunk } from '../chunkLoad';
import { offerTableRenderer } from '../effects/warm';
import Venue3D, { feltPatternTexture, preloadVenueAssets } from './Venue3D';
import ClassicStudio, { preloadClassicStudio } from './ClassicStudio';
import BarbershopRoom, { preloadBarbershopRoom } from './BarbershopRoom';
import RooftopRoom, { preloadRooftopRoom } from './RooftopRoom';
import YachtRoom, { preloadYachtRoom } from './YachtRoom';
import BeachRoom, { preloadBeachRoom } from './BeachRoom';
import BackyardRoom, { preloadBackyardRoom } from './BackyardRoom';
import ChurchRoom, { preloadChurchRoom } from './ChurchRoom';
import VegasRoom, { preloadVegasRoom } from './VegasRoom';
import SpeakeasyRoom, { preloadSpeakeasyRoom } from './SpeakeasyRoom';
import GrandmaRoom, { preloadGrandmaRoom } from './GrandmaRoom';
import MansionRoom, { preloadMansionRoom } from './MansionRoom';
import { type VenueDef, type VenueId, VENUE_DEFS, venueAssetUrls } from '../venues';
import { bodyGeometry, cardGeometry, feltGeometry, railGeometry } from './geometry';
import {
  CH, CW, MIN_STRIP_PX, TRICK_SCALE, type FanOpts, type SeatPos, type Xform, badgeSpot, cameraFor, cameraPoseAt, CAMERA_VIEW_TWEEN_MS, cardScreenQuad, deckSpot, fanCssPx, fanLayout, handCardPlane, handFan, makeCamera, jitterOf, opponentFan, phoneHandFan, PHONE_HAND_STRIP_PX, pileSpot, ringSpot, trickSpot,
  flatRest,
  xf,
} from './layout';

export interface SceneProps {
  quality: 'high' | 'low';
  /** the 3D table has rendered its first frame (the placeholder fades out). Textures and the hall light stream in after this. */
  onTableReady?: () => void;
  /** Felt and rail maps have settled (each one applied, or that download failed), so the cloth is no longer a flat stand-in. */
  onTableDressed?: () => void;
  /** True once the 3D hand is the fan on screen. False returns the flat fan; it must not stay true across a hand the 3D scene has stopped drawing. */
  onHandLive?: (live: boolean) => void;
  /** The intro hand's deal has played out on the scene's own clock (frames, capped like the cards). */
  onDealDone?: (handNo: number) => void;
  n: number;
  handNo: number;
  dealer: number;
  positions: SeatPos[];
  human: number;
  /** null while the human's cards are face down (Blind Nil decision). */
  myHand: Card[] | null;
  handCounts: number[];
  shownTrick: Play[];
  /** Completed tricks of this hand that are already swept to piles. */
  piles: Trick[];
  legal: Card[];
  selected: Card | null;
  turnSeat: number | null;
  winnerSeat: number | null;
  promoted: (c: Card) => boolean;
  onCardTap: (c: Card) => void;
  /** Drag-to-play: a legal card released over the felt. */
  onCardDrop?: (c: Card, slam?: number, rel?: [number, number]) => void;
  /** Tips ON keeps fixed trick spots; OFF lands cards where they were thrown (each viewer decides). */
  landing?: 'fixed' | 'physics';
  /** The game's seed: with hand, trick and card it seeds every landing, so all clients agree. */
  gameSeed?: string;
  /** A tap on the cloth, not on a card. Puts the raised card down. */
  onFeltTap?: () => void;
  renderSeat: (seat: number) => ReactNode;
  /** Hand number whose shuffle + deal should be animated (null = place cards instantly, e.g. after a refresh). */
  introHand: number | null;
  /** The intro hand's deal is still running (bots and your turn wait for it). */
  dealing?: boolean;
  /** The table is on screen. The intro hand is not drawn before this, so the deal is never hidden behind the loader. */
  dealReady?: boolean;
  /** Game-speed factor (1 = normal, 0.5 = fast…): scales the shuffle/deal timeline. */
  animK: number;
  /** Landing sounds for a played card ('play' or 'play,cut' / 'play,broken'). */
  landCue: (card: Card) => string;
  /** Phone landscape layout (see viewport.ts): own camera, smaller trick, hand between the HUD corners. */
  short?: boolean;
  /** Safe-area insets in CSS px. */
  safe?: { l: number; r: number; t: number; b: number };
  /** Tips mode. The turn lift is the same 14px either way; tip marks still use `marked`. */
  hintLegal?: boolean;
  /** cards an open tip points at: they glow (on the table and in your hand) */
  marked?: Card[];
  /** Reduce effects: the venue stays calm and the nuke plays its calm version. */
  reduceFx?: boolean;
  /** 'Run it!': the claimer's remaining cards slam down face up in a row at the table centre ALL AT ONCE, then
   *  everyone else's remaining cards hit the table together in a quick cascade (then the tornado takes everything) */
  slam?: { seat: number; cards: Card[]; others?: { seat: number; card: Card }[] } | null;
  /** the venue (3D arena) around the table; default classic */
  venue?: VenueId;
  /** camera view: standing (default) or sitting (lower/closer) */
  view?: 'standing' | 'sitting';
  /** Turn up (slam mode): Standing drags slam at max only when this is on. */
  turnUp?: boolean;
}

function CameraRig({ view = 'standing' }: { view?: 'standing' | 'sitting' }) {
  const { camera, size, invalidate } = useThree();
  const short = isShortLandscape(size.width, size.height);
  const anim = useRef<{ from: number[]; to: number[]; fromLook: number[]; toLook: number[]; start: number; dur: number } | null>(null);
  const booted = useRef(false);
  const lookAtRef = useRef<number[] | null>(null);
  useLayoutEffect(() => {
    const a = size.width >= 32 && size.height >= 32 ? size.width / size.height : 9 / 16;
    const spec = cameraFor(a, short, view);
    const cam = camera as import('three').PerspectiveCamera;
    if (!Number.isFinite(spec.fov)) return;
    cam.fov = spec.fov;
    cam.aspect = a;
    cam.updateProjectionMatrix();
    sound.setSpatialListener(spec.pos, spec.look); // audio listener follows Sitting/Standing
    const probe = (t: number) => { (window as unknown as { __bwmCam?: unknown }).__bwmCam = { view, y: cam.position.y, z: cam.position.z, x: cam.position.x, t, tweenMs: CAMERA_VIEW_TWEEN_MS }; };
    if (!booted.current) { // first frame: land exactly on the saved view, no flight
      booted.current = true;
      cam.position.set(...spec.pos); cam.lookAt(new Vector3(...spec.look));
      lookAtRef.current = [...spec.look]; probe(1); invalidate(); return;
    }
    // Respect ONLY the real OS setting; the app's Reduce-effects pref must not kill the move.
    const reduced = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const fromLook = lookAtRef.current ?? (() => { const d = new Vector3(); cam.getWorldDirection(d); return [cam.position.x + d.x, cam.position.y + d.y, cam.position.z + d.z]; })();
    anim.current = { from: [cam.position.x, cam.position.y, cam.position.z], to: [...spec.pos], fromLook: [...fromLook], toLook: [...spec.look], start: performance.now(), dur: reduced ? 0 : CAMERA_VIEW_TWEEN_MS };
    probe(0);
    invalidate();
  }, [camera, size, short, view, invalidate]);
  useFrame(() => {
    const a = anim.current; if (!a) return;
    const cam = camera as import('three').PerspectiveCamera;
    // Wall clock, never raw frame dt (see cameraPoseAt): an idle demand-loop's first dt is huge.
    const pose = cameraPoseAt(a.from, a.to, a.fromLook, a.toLook, performance.now() - a.start, a.dur);
    cam.position.set(pose.pos[0]!, pose.pos[1]!, pose.pos[2]!);
    cam.lookAt(new Vector3(pose.look[0]!, pose.look[1]!, pose.look[2]!));
    sound.setSpatialListener(pose.pos, pose.look);
    lookAtRef.current = pose.look;
    (window as unknown as { __bwmCam?: unknown }).__bwmCam = { view, y: cam.position.y, z: cam.position.z, x: cam.position.x, t: pose.t, tweenMs: CAMERA_VIEW_TWEEN_MS };
    if (pose.t >= 1) anim.current = null;
    invalidate();
  });
  return null;
}

/**
 * Hype-effect thump (fx.shake: jokers, the nuke, slams). Vertical only — see shake.ts. The offsets are added on top
 * of whatever CameraRig set and removed again every frame, so the layout camera never drifts.
 */
function FxShake({ table }: { table: RefObject<Group | null> }) {
  const { camera, invalidate } = useThree();
  const applied = useRef({ x: 0, y: 0, z: 0, roll: 0, ty: 0 });
  const last = useRef<object | null>(null);
  useEffect(() => fx.on(() => invalidate()), [invalidate]);
  useFrame(() => {
    const a = applied.current;
    camera.position.x -= a.x; camera.position.y -= a.y; camera.position.z -= a.z; camera.rotateZ(-a.roll);
    if (table.current) table.current.position.y -= a.ty;
    a.x = a.y = a.z = a.roll = a.ty = 0;
    // 'Run it!': a slow camera sway while the funnel spins (none under Reduce effects)
    const T = fx.tornado;
    if (T && !T.reduced) {
      const u = (fx.warp !== null ? fx.warp : (performance.now() - T.start) / 1000) + 0.4;
      if (u > 0 && u < 2.6) {
        const o = swayOffset(u);
        a.y += o.y;
        invalidate();
      }
    }
    const s = fx.shake;
    if (s) {
      const t = (performance.now() - s.start) / 1000;
      if (t < 0) invalidate();
      else if (t > s.dur) { if (last.current === s) fx.shake = null; invalidate(); }
      else {
        last.current = s;
        const o = shakeOffset(s, t);
        a.x += o.x; a.y += o.y; a.z += o.z; a.roll += o.roll; a.ty += o.ty;
        invalidate();
      }
    }
    camera.position.x += a.x; camera.position.y += a.y; camera.position.z += a.z; camera.rotateZ(a.roll);
    if (table.current) table.current.position.y += a.ty;
  });
  return null;
}

/**
 * Table textures. High quality keeps 1k colour / normal maps; roughness maps are 512 at both levels (their detail
 * doesn't show at table distance, and they were the heaviest files). The hall HDRI streams in after the cloth.
 */
/** Warm the image cache (called from the splash / wizard via three/preload.ts). Does not suspend the table. */
export function preloadTableAssets(quality: 'high' | 'low', venue: VenueId = 'classic'): void {
  const rail = venueAssetUrls(venue, quality).rail;
  prefetchTableTextures(quality, rail ? [rail] : []);
  // The classic hall HDRI is ~400 KB and its PMREM filter used to freeze the page after the felt appeared.
  // It starts only once the cloth is up (see ClassicHall). Other venues still warm their own files here.
  if (venue === 'barbershop') preloadBarbershopRoom();
  else if (venue === 'rooftop') preloadRooftopRoom();
  else if (venue === 'yacht') preloadYachtRoom();
  else if (venue === 'beach') preloadBeachRoom();
  else if (venue === 'backyard') preloadBackyardRoom();
  else if (venue === 'church') preloadChurchRoom();
  else if (venue === 'vegas') preloadVegasRoom();
  else if (venue === 'speakeasy') preloadSpeakeasyRoom();
  else if (venue === 'grandma') preloadGrandmaRoom();
  else if (venue === 'mansion') preloadMansionRoom();
  else if (venue !== 'classic') preloadVenueAssets(venue, quality);
  else if (quality === 'high') preloadClassicStudio();
}

/** a venue's rail texture (marble / teak / bamboo / leather) rides with the table textures (20–35 KB) */
function railTextureUrl(def: VenueDef, quality: 'high' | 'low'): string | null {
  return venueAssetUrls(def.id, quality).rail;
}

function flatTex(bytes: [number, number, number, number], srgb = false): DataTexture {
  const t = new DataTexture(new Uint8Array(bytes), 1, 1);
  t.wrapS = t.wrapT = RepeatWrapping;
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function isColorMap(url: string): boolean {
  return url.includes('diff') || url.includes('/venues/');
}

/** Decode the cloth and wood maps as they arrive and publish one Texture per frame (a single upload). */
function useStreamedMaps(urls: string[]): { maps: (Texture | null)[]; settled: boolean } {
  const invalidate = useThree((s) => s.invalidate);
  const key = urls.join('|');
  const [maps, setMaps] = useState<(Texture | null)[]>(() => urls.map(() => null));
  const [settled, setSettled] = useState(urls.length === 0);
  useEffect(() => {
    const list = key ? key.split('|') : [];
    if (!list.length) { setSettled(true); return; }
    let alive = true;
    setSettled(false);
    const status = list.map(() => 'wait' as 'wait' | 'ok' | 'bad');
    const imgs: HTMLImageElement[] = [];
    const made = list.map(() => false);
    list.forEach((url, i) => {
      loadTableImage(url).then((img) => { status[i] = 'ok'; imgs[i] = img; }).catch(() => { status[i] = 'bad'; });
    });
    const pump = () => {
      if (!alive) return;
      const i = status.findIndex((s, idx) => s === 'ok' && !made[idx]);
      if (i >= 0) {
        made[i] = true;
        const tex = new Texture(imgs[i]!);
        tex.needsUpdate = true;
        tex.wrapS = tex.wrapT = RepeatWrapping;
        if (isColorMap(list[i]!)) tex.colorSpace = SRGBColorSpace;
        setMaps((prev) => { const next = prev.slice(); next[i] = tex; return next; });
        invalidate();
      }
      const done = status.every((s, idx) => s === 'bad' || made[idx]);
      if (done) { if (alive) setSettled(true); return; }
      requestAnimationFrame(pump);
    };
    const id = requestAnimationFrame(pump);
    return () => { alive = false; cancelAnimationFrame(id); };
  }, [key, invalidate]);
  return { maps, settled };
}

type TableGeos = { felt: BufferGeometry; rail: BufferGeometry; body: BufferGeometry };
let geosCache: TableGeos | null = null;

/** Felt, rail, then apron, each in its own frame. The first paint uses a flat disc so extrude work is not on it. */
function useTableGeos(): TableGeos | null {
  const [geos, setGeos] = useState<TableGeos | null>(geosCache);
  useEffect(() => {
    if (geosCache) { setGeos(geosCache); return; }
    let alive = true;
    void (async () => {
      await nextFrame();
      if (!alive) return;
      const felt = feltGeometry();
      await nextFrame();
      if (!alive) return;
      const rail = railGeometry();
      await nextFrame();
      if (!alive) return;
      geosCache = { felt, rail, body: bodyGeometry() };
      if (alive) setGeos(geosCache);
    })();
    return () => { alive = false; };
  }, []);
  return geos;
}

function buildTableMaterials(def: VenueDef, quality: 'high' | 'low') {
  const hi = quality === 'high';
  const flatN = flatTex([128, 128, 255, 255]);
  const flatR = flatTex([255, 255, 255, 255]);
  const white = flatTex([255, 255, 255, 255], true);
  let felt: MeshStandardMaterial;
  if (def.feltPattern) {
    felt = new MeshStandardMaterial({ map: feltPatternTexture(def.feltPattern, def.felt), roughness: def.feltPattern === 'gingham' ? 0.45 : 0.6, envMapIntensity: 0.25 });
    if (def.feltPattern === 'gingham') { felt.normalMap = flatN; felt.normalScale.set(0.15, 0.15); }
  } else {
    felt = new MeshStandardMaterial({ color: def.felt, roughness: 1, roughnessMap: flatR, normalMap: flatN, envMapIntensity: 0.35 });
    felt.normalScale.set(0.9, 0.9);
  }
  let wood: MeshStandardMaterial;
  switch (def.rail) {
    case 'crystal':
      wood = new MeshPhysicalMaterial({ color: def.railTint, roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0.55, iridescence: hi ? 0.35 : 0, envMapIntensity: 2.2 });
      break;
    case 'chrome':
      wood = new MeshStandardMaterial({ color: def.railTint, metalness: 1, roughness: 0.14, envMapIntensity: 1.6 });
      break;
    case 'metal':
      wood = new MeshStandardMaterial({ color: def.railTint, metalness: 0.65, roughness: 0.38 });
      break;
    case 'leather':
      wood = new MeshStandardMaterial({ map: white, color: def.railTint, roughness: 0.5, normalMap: flatN, normalScale: new Vector2(0.3, 0.3) });
      break;
    case 'wood':
      wood = hi
        ? new MeshPhysicalMaterial({ map: white, normalMap: flatN, roughnessMap: flatR, roughness: 0.8, clearcoat: 0.8, clearcoatRoughness: 0.18, color: def.railTint })
        : new MeshStandardMaterial({ map: white, normalMap: flatN, roughness: 0.45, color: def.railTint });
      break;
    default:
      wood = hi
        ? new MeshPhysicalMaterial({ map: white, roughness: 0.55, clearcoat: 0.7, clearcoatRoughness: 0.2, color: def.railTint })
        : new MeshStandardMaterial({ map: white, roughness: 0.45, color: def.railTint });
  }
  const apron = def.rail === 'crystal'
    ? new MeshPhysicalMaterial({ color: def.apron, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.4 })
    : def.rail === 'chrome' || def.rail === 'metal'
      ? new MeshStandardMaterial({ color: def.apron, metalness: 0.7, roughness: 0.3 })
      : new MeshStandardMaterial({ map: white, roughness: 0.6, color: def.apron });
  const floor = new MeshStandardMaterial({ color: '#120b18', roughness: 0.95 });
  return { felt, wood, apron, floor };
}

function TableModel({ quality, lit, onReady, onTextured, def }: { quality: 'high' | 'low'; lit: boolean; onReady?: () => void; onTextured?: () => void; def: VenueDef }) {
  const railUrl = railTextureUrl(def, quality);
  const urls = useMemo(() => (railUrl ? [...tableTextureUrls(quality), railUrl] : tableTextureUrls(quality)), [quality, railUrl]);
  const { maps, settled } = useStreamedMaps(urls);
  const invalidate = useThree((s) => s.invalidate);
  const geos = useTableGeos();
  const basic = useMemo(() => ({
    felt: new MeshBasicMaterial({ color: def.felt }),
    wood: new MeshBasicMaterial({ color: def.railTint }),
    apron: new MeshBasicMaterial({ color: def.apron }),
    floor: new MeshBasicMaterial({ color: '#120b18' }),
    stripe: new MeshBasicMaterial({ color: '#d9b04a', transparent: true, opacity: 0.35, depthWrite: false }),
  }), [def]);
  const full = useMemo(() => buildTableMaterials(def, quality), [def, quality]);
  const logo = useMemo(() => logoTexture(invalidate), [invalidate]);
  const logoMat = useMemo(() => new MeshBasicMaterial({ map: logo, transparent: true, opacity: 0.13, depthWrite: false }), [logo]);
  const textured = useRef(false);
  // Swap placeholder maps for the real ones one texture per frame, after the lit shaders are already linked.
  useEffect(() => {
    if (!lit) return;
    const jobs: (() => void)[] = [];
    const [feltN, feltR, woodC, woodN, woodR, railMap] = maps;
    const take = (tex: Texture | null, apply: (t: Texture) => void, repeat: number) => {
      if (!tex || tex.userData.applied) return;
      jobs.push(() => {
        tex.userData.applied = 1;
        tex.repeat.set(repeat, repeat);
        apply(tex);
        invalidate();
      });
    };
    if (!def.feltPattern) {
      take(feltN ?? null, (t) => { full.felt.normalMap = t; full.felt.normalScale.set(0.9, 0.9); full.felt.needsUpdate = true; }, 2.2);
      take(feltR ?? null, (t) => { full.felt.roughnessMap = t; full.felt.needsUpdate = true; }, 2.2);
    } else if (def.feltPattern === 'gingham') {
      take(feltN ?? null, (t) => { full.felt.normalMap = t; full.felt.normalScale.set(0.15, 0.15); full.felt.needsUpdate = true; }, 2.2);
    }
    if (def.rail === 'wood') {
      take(woodC ?? null, (t) => { full.wood.map = t; full.wood.needsUpdate = true; if (full.apron.map) { full.apron.map = t; full.apron.needsUpdate = true; } }, 0.9);
      take(woodN ?? null, (t) => { full.wood.normalMap = t; full.wood.needsUpdate = true; }, 0.9);
      take(woodR ?? null, (t) => { if (full.wood.roughnessMap) { full.wood.roughnessMap = t; full.wood.needsUpdate = true; } }, 0.9);
    } else if (def.rail === 'leather') {
      take(railMap ?? null, (t) => { full.wood.map = t; full.wood.needsUpdate = true; full.apron.map = t; full.apron.needsUpdate = true; }, 1.4);
      take(feltN ?? null, (t) => { full.wood.normalMap = t; full.wood.normalScale.set(0.3, 0.3); full.wood.needsUpdate = true; }, 2.2);
    } else if (def.rail !== 'crystal' && def.rail !== 'chrome' && def.rail !== 'metal') {
      take(railMap ?? null, (t) => { full.wood.map = t; full.wood.needsUpdate = true; full.apron.map = t; full.apron.needsUpdate = true; }, 1.4);
    }
    let i = 0;
    let raf = 0;
    const step = () => {
      if (i < jobs.length) { jobs[i++]!(); raf = requestAnimationFrame(step); return; }
      const need = urls.length;
      const have = maps.filter(Boolean).length;
      if (!textured.current && have >= need && need > 0) {
        textured.current = true;
        const w = window as unknown as { __bwmTexturedAt?: number };
        w.__bwmTexturedAt ??= performance.now();
        onTextured?.();
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [lit, maps, def, full, urls.length, invalidate, onTextured]);
  // A failed download never fills its slot. Once nothing is still in flight, lift the loading screen anyway.
  useEffect(() => {
    if (!settled || textured.current) return;
    if (maps.some((m) => !m)) {
      textured.current = true;
      const w = window as unknown as { __bwmTexturedAt?: number };
      w.__bwmTexturedAt ??= performance.now();
      onTextured?.();
    }
  }, [settled, maps, onTextured]);
  useEffect(() => {
    const w = window as unknown as { __bwmTableAt?: number };
    const a = requestAnimationFrame(() => requestAnimationFrame(() => { w.__bwmTableAt ??= performance.now(); onReady?.(); }));
    return () => cancelAnimationFrame(a);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const feltMat = lit ? full.felt : basic.felt;
  const woodMat = lit ? full.wood : basic.wood;
  const apronMat = lit ? full.apron : basic.apron;
  return (
    <group>
      {geos ? (
        <>
          <mesh geometry={geos.felt} material={feltMat} receiveShadow />
          <mesh geometry={geos.rail} material={woodMat} castShadow receiveShadow />
          <mesh geometry={geos.body} material={apronMat} receiveShadow />
        </>
      ) : (
        <mesh rotation={[-Math.PI / 2, 0, 0]} material={feltMat} receiveShadow>
          <circleGeometry args={[1.22, 32]} />
        </mesh>
      )}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0015, -0.02]}>
        <planeGeometry args={[1.5, 1.5 * (688 / 2552)]} />
        <primitive object={logoMat} attach="material" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
        <ringGeometry args={[0.95, 0.965, 96]} />
        <primitive object={basic.stripe} attach="material" />
      </mesh>
      {def.id === 'classic' && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.9, 0]} receiveShadow>
          <planeGeometry args={[30, 30]} />
          <primitive object={lit ? full.floor : basic.floor} attach="material" />
        </mesh>
      )}
    </group>
  );
}

function TurnRing({ pos, n, active }: { pos: SeatPos; n: number; active: boolean }) {
  const p = ringSpot(pos, n);
  const mat = useRef<MeshBasicMaterial>(null);
  // your-turn glow only: a soft breathing halo (Table passes turnSeat only when it's the human's turn)
  useFrame(({ clock }) => { if (mat.current) mat.current.opacity = 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 3)); });
  if (!active) return null;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[p.x, 0.003, p.z]}>
      <ringGeometry args={[0.15, 0.21, 64]} />
      <meshBasicMaterial ref={mat} color="#c58bff" transparent opacity={0.5} toneMapped={false} depthWrite={false} />
    </mesh>
  );
}

/** The same spot, turned face-down (180° about the card's own long axis) — the start pose of a flip-in-place. */
const FLIP_Q = new Quaternion(0, 1, 0, 0);
function flipped(t: Xform): Xform {
  const q = new Quaternion(...t.q).multiply(FLIP_Q);
  return { p: [t.p[0], t.p[1], t.p[2]], q: [q.x, q.y, q.z, q.w], s: t.s };
}

function Cards(props: SceneProps & { dragCard?: Card | null; aspect: number; fontsReady: boolean; safeFrac: number; lit: boolean }) {
  const { safeFrac, quality, n, handNo, dealer, positions, human, myHand, handCounts, shownTrick, piles, legal, selected, promoted, onCardTap } = props;
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const canvasSize = useThree((s) => s.size);
  // Drag-to-play: where a dropped card starts its flight (the finger point), fixed once per play.
  const dropOrigins = useRef(new Map<string, Xform>());
  const invalidate = useThree((s) => s.invalidate);
  const aniso = Math.min(quality === 'high' ? 8 : 2, gl.capabilities.getMaxAnisotropy());
  const res = quality;
  const back = backTexture(res, aniso); // cached per deck inside backTexture; read every render so a Setup deck change switches every back at once
  const face = (c: Card) => faceTexture(c, res, promoted(c), aniso);
  // A resumed hand is already dealt: paint one face per frame, and bring opponent cards in a few at a time,
  // so the first WebGL frame is the table plus your hand instead of every card's canvas and shader at once.
  const resume = props.introHand !== handNo;
  const faceKey = `${(myHand ?? []).join(',')}|${shownTrick.map((p) => p.card).join(',')}|${res}`;
  const [nFaces, setNFaces] = useState(0);
  const [extra, setExtra] = useState(resume ? 0 : 999);
  useEffect(() => { setNFaces(0); }, [faceKey]);
  useEffect(() => {
    const cards = [...(myHand ?? []), ...shownTrick.map((p) => p.card)];
    if (nFaces >= cards.length) return;
    const id = requestAnimationFrame(() => {
      const c = cards[nFaces];
      if (c) faceTexture(c, res, promoted(c), aniso);
      setNFaces((k) => k + 1);
    });
    return () => cancelAnimationFrame(id);
  }, [nFaces, faceKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!resume || extra > 64) return;
    const id = requestAnimationFrame(() => setExtra((k) => k + 4));
    return () => cancelAnimationFrame(id);
  }, [resume, extra]);
  useEffect(() => (props.fontsReady ? refreshFacesGradually(() => invalidate()) : undefined), [props.fontsReady, invalidate]);
  const deck = deckSpot(positions[dealer]!, n);
  const intro = props.introHand === handNo;
  const held0 = dealHeld({ intro, dealReady: props.dealReady !== false });
  // Blind Nil: cards that were dealt face-down flip over in place on reveal — never re-dealt from the deck
  const hiddenHand = useRef<number | null>(null);
  if (myHand === null) hiddenHand.current = handNo;
  const flipIn = myHand !== null && hiddenHand.current === handNo;
  const flippedHand = useRef<number | null>(null);
  // Card ids whose front has resolved. A selection rerender must not drop them: the front mesh
  // is rebuilt on the BWM back the moment an id leaves this set.
  const faceShown = useRef(new Set<string>());
  const faceHand = useRef<number | null>(null);
  // Plays already given their opening flight. A later render (or a canvas rebuild) must not
  // launch them from the face-down fan again.
  const playShown = useRef<{ hand: number; keys: Set<string> }>({ hand: -1, keys: new Set() });
  // Cards already in the trick on the first paint of a resumed scene. They must not fly in later.
  const openingTrick = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!flipIn || flippedHand.current === handNo) return;
    flippedHand.current = handNo;
    sound.play('flip');
    const w = window as unknown as { __bwmFlips?: Record<number, number> };
    (w.__bwmFlips ??= {})[handNo] = (w.__bwmFlips[handNo] ?? 0) + 1;
  }, [flipIn, handNo]);
  const tl = dealTimeline(props.animK, n, handCounts.reduce((a, b) => a + b, 0) + piles.length * n + shownTrick.length);
  // The cards' tweens advance at most 50ms a frame, so on a slow device they run behind the wall clock.
  // Count the deal the same way and report when the last card has landed: until then nobody acts.
  const dealClock = useRef<{ hand: number; t: number; done: boolean }>({ hand: -1, t: 0, done: false });
  const onDealDone = props.onDealDone;
  const dealArmed = intro && !held0;
  useFrame((_, rawDt) => {
    const c = dealClock.current;
    if (!dealArmed) return;
    if (c.hand !== handNo) { c.hand = handNo; c.t = 0; c.done = false; }
    if (c.done) return;
    c.t += Math.min(Math.max(rawDt, 0), 0.05);
    if (c.t >= tl.total + 0.05) { c.done = true; onDealDone?.(handNo); } else invalidate();
  });
  const size = useThree((s) => s.size);
  const short = isShortLandscape(size.width, size.height); // from the canvas size, like the camera — never out of step with it
  // A 0×0 canvas (first frame, iPhone chrome) must not divide. That NaN pose sticks: lerp never leaves it,
  // and the next trick is an empty gold box where the hand was.
  const sized = size.width >= 32 && size.height >= 32;
  const aspect = sized ? size.width / size.height : 390 / 844;
  const screenH = sized ? size.height : 844;
  const screenW = sized ? size.width : 390;
  const safe = props.safe ?? { l: 0, r: 0, t: 0, b: 0 };
  // landscape: the bottom corners hold your plate (left) and last trick + controls (right); the hand fans between
  // desktop / wide: a bigger hand (≈35% over the 0.16 default), kept between your plate (left) and last trick (right)
  const wide = !short && size.width >= 1024 && aspect >= 1.3;
  // Portrait phones get a larger hand. Wide and landscape keep their own framing.
  const portraitPhone = !short && !wide && size.width < 600 && aspect < 1.05;
  const strip = { minStripPx: MIN_STRIP_PX, pxW: screenW };
  const view = props.view ?? 'standing';
  // Sitting: lift the whole fan above the iPhone home indicator + Safari bottom chrome (safe-area
  // bottom + a 12px breathing margin), in the LIVE view's camera. Standing keeps its exact framing.
  const sittingBottom = view === 'sitting' ? (safe.b + 12) / Math.max(1, screenH) : 0;
  const fanOpts: FanOpts = short
    ? { short, view, reserveFrac: (Math.max(safe.l, safe.r) + 186) / size.width, bottomFrac: safe.b / Math.max(1, size.height) + sittingBottom, heightFrac: 0.32, ...strip } // bigger hand in landscape (was 0.25)
    : wide ? { view, reserveFrac: (size.width < 1400 ? 250 : 205) / size.width, bottomFrac: 0.012, heightFrac: 0.256, ...strip } // +25% hand (was 0.205)
    : portraitPhone ? { ...phoneHandFan(), view, bottomFrac: (phoneHandFan().bottomFrac ?? 0) + sittingBottom, ...strip, minStripPx: (handCounts[human] ?? 13) > 13 ? MIN_STRIP_PX : PHONE_HAND_STRIP_PX }
    : { view, ...strip };
  const trickScale = short ? 1.81 : undefined; // +25% over the old 1.45, same ratio as TRICK_SCALE
  // Last committed hand, so a play can launch from that card's own slot. Updated in an effect (not during render)
  // so a highlight change and the server ack share one set of keys and don't restart the fan.
  type Held = { handNo: number; cards: Set<string>; slots: Map<string, Xform>; count: number; seen: Set<string> };
  const held = useRef<Held>({ handNo: -1, cards: new Set(), slots: new Map(), count: 0, seen: new Set() });
  if (held.current.handNo !== handNo) held.current = { handNo, cards: new Set(), slots: new Map(), count: 0, seen: new Set() };
  const pendingHold = useRef<Held>(held.current);

  type Item = { spatialSeat?: SeatPos; spatialN?: number; slam?: import('../slam').SlamFeel; key: string; card: Card | null; cardId?: string | null; target: Xform; from?: Xform; origin?: Xform; delay?: number; dim?: boolean; glow?: boolean; tap?: ((cardId: string) => void) | null; shadow?: boolean; duration?: number; arc?: number; motion?: 'lift' | 'flight' | 'slide' | 'glide' | 'gather'; raise?: number; roll?: number; order?: number; sfxStart?: Sfx; sfxLand?: string; hand?: boolean; public?: boolean; holdUntilMove?: boolean };
  const items: Item[] = [];
  // Seats still in this hand (a Cutthroat ejection leaves a seat with no cards): the deal
  // schedule goes around these only, or late cards are timed past the end of the deal.
  const liveSeatsForDeal = handCounts.flatMap((c, seat) => (c > 0 ? [seat] : []));
  const dealDelay = (slot: number, seat: number) => seatDealDelay(tl, n, slot, seat, dealer, liveSeatsForDeal);

  // completed tricks in piles
  const pileCount = Array(n).fill(0) as number[];
  for (const t of piles) {
    const w = t.winner!;
    const k = pileCount[w]!++;
    t.plays.forEach((pl, j) => {
      // Per-BOOK jitter (not per-card): all cards in one won trick share the
      // same offset/rotation so the book stacks cleanly and the top card
      // blends in with the ones under it. Demetrius 2026-10-19.
      items.push({ key: `${handNo}-${pl.card}`, card: pl.card, target: pileSpot(positions[w]!, n, k, j, jitterOf(`book-${handNo}-${w}-${k}`)), duration: 0.55, arc: 0.15, motion: 'gather', sfxStart: 'sweep', spatialSeat: positions[w]!, spatialN: n });
    });
  }
  // cards on the table this trick
  // last-trick nuke: the auto-played final cards fly in one after another, right into the blast
  const firstAuto = shownTrick.findIndex((pl) => pl.auto);
  if (playShown.current.hand !== handNo) playShown.current = { hand: handNo, keys: new Set() };
  if (openingTrick.current === null) openingTrick.current = openingTrickKeys(resume, shownTrick.map((pl) => `${handNo}-${pl.card}`));
  // Physics landing: every client derives the same resting offsets from the seed + release vector.
  const physics = props.landing === 'physics';
  const trickNo = piles.length;
  const lands = physics
    ? landTrick(
      shownTrick.map((pl) => ({ card: pl.card, rel: pl.rel })),
      shownTrick.map((pl, order) => { const t = trickSpot(positions[pl.seat]!, n, order, jitterOf(pl.card), trickScale); return { x: t.p[0], z: t.p[2] }; }),
      { hw: (CW * (trickScale ?? TRICK_SCALE)) / 2, hh: (CH * (trickScale ?? TRICK_SCALE)) / 2 },
      (card) => playSeed(props.gameSeed ?? '', handNo, trickNo, card),
      VISIBLE_FELT,
    )
    : [];
  const reduced = reducedMotion();
  shownTrick.forEach((pl, order) => {
    const autoDelay = pl.auto ? { delay: 0.35 + 0.12 * (order - firstAuto) } : {};
    const leftHand = pl.seat === human ? departureSlot(held.current.slots, held.current.cards, pl.card) : undefined;
    const playKey = `${handNo}-${pl.card}`;
    const fan = pl.seat === human ? undefined : opponentFan(positions[pl.seat]!, n, Math.max(0, handCounts[pl.seat]! - 1) / 2, handCounts[pl.seat]! + 1);
    const launches = trickCardLaunches(playKey, openingTrick.current!, playShown.current.keys);
    // A drag drop flies from the finger point, never back through the hand slot.
    let origin = dropOrigins.current.get(playKey) ?? leftHand;
    if (pl.seat === human && !dropOrigins.current.has(playKey) && launches) {
      const d = takeDrop(pl.card);
      const base = leftHand ?? trickSpot(positions[pl.seat]!, n, order, jitterOf(pl.card), trickScale);
      if (d && canvasSize.width > 0) {
        const z = new Vector3(...base.p).project(camera).z;
        const w = new Vector3((d.x / canvasSize.width) * 2 - 1, -((d.y / canvasSize.height) * 2 - 1), z).unproject(camera);
        if (Number.isFinite(w.x) && Number.isFinite(w.y) && Number.isFinite(w.z)) {
          origin = { ...base, p: [w.x, w.y, w.z] };
          dropOrigins.current.set(playKey, origin);
        }
        clearDrop(pl.card);
      }
    }
    const from = origin && origin !== leftHand ? origin : trickPlayFrom({ firstShow: launches, humanSlot: leftHand, fan });
    const dragged = typeof pl.slam === 'number';
    const feel = slamFeel(dragged ? pl.slam! : DEFAULT_SLAM, reducedMotion());
    const land = lands[order];
    // Two-tap / bot tosses vary a little per play (same seed → same toss on every client); reduced motion slides.
    const toss = land && !dragged ? 0.8 + ((playSeed(props.gameSeed ?? '', handNo, trickNo, pl.card) % 1000) / 1000) * 0.5 : 1;
    const flight = props.landCue(pl.card).includes(',overcut') ? { duration: 0.34, arc: 0.7 } : dragged ? { duration: feel.duration, arc: feel.arc } : { duration: 0.5, arc: 0.35 * toss };
    items.push({ key: playKey, card: pl.card, public: true, target: trickSpot(positions[pl.seat]!, n, order, jitterOf(pl.card), trickScale, land), from, origin, slam: dragged ? feel : { ...feel, intensity: -1 }, ...flight, ...(land && reduced ? { motion: 'slide' as const, arc: 0 } : land && !props.landCue(pl.card).includes(',overcut') ? { motion: 'glide' as const, arc: Math.min(0.3, flight.arc) } : {}), sfxLand: props.landCue(pl.card), spatialSeat: positions[pl.seat]!, spatialN: n, glow: !!props.marked?.includes(pl.card), ...autoDelay });
  });
  // 'Run it!': the claimer's cards slam down in sequence (then the tornado takes everything)
  if (props.slam) {
    const { seat, cards } = props.slam;
    const k = cards.length;
    // Thrown down one after another and scattered like real cards hitting a table (every viewer, Tips or not:
    // it's a show moment). Same seed on every client, so online tables see the same pile. Reduced motion: a tidy row.
    const drops = reduced ? null : runScatter(playSeed(props.gameSeed ?? '', handNo, 99, `runit:${seat}`), k);
    if (typeof window !== 'undefined') (window as unknown as { __bwmRunDrop?: unknown }).__bwmRunDrop = { cards, drops, reduced };
    cards.forEach((c, i) => {
      const base = trickSpot('bottom', n, i, jitterOf(c), trickScale);
      const w = CW * (trickScale ?? TRICK_SCALE) * 0.84; // slightly overlapped: 4 cards ≈ the trick's width
      const d = drops?.[i];
      const target: Xform = d
        ? flatRest(d.dx, d.dz, d.spin, 4 + i, base.s) // flat on the felt, above any trick cards
        : { ...base, p: [(i - (k - 1) / 2) * w, base.p[1] + 0.01 * i, 0.02] };
      const leftHand = seat === human ? departureSlot(held.current.slots, held.current.cards, c) : undefined;
      const from = leftHand ?? (seat === human ? undefined : opponentFan(positions[seat]!, n, Math.min(i, k - 1), k));
      if (d) items.push({ key: `${handNo}-${c}`, card: c, public: true, target, from, origin: leftHand, delay: 0.02 + d.delay, duration: 0.3, arc: 0.3, slam: slamFeel(i === k - 1 ? 1 : 0.85), sfxLand: i === k - 1 ? 'play,runSlam' : 'play', spatialSeat: positions[seat]!, spatialN: n });
      else items.push({ key: `${handNo}-${c}`, card: c, public: true, target, from, origin: leftHand, delay: 0.02, duration: RUN_SLAM_MS / 1000, arc: reduced ? 0 : 0.9, ...(reduced ? { motion: 'slide' as const } : {}), sfxLand: i === k - 1 ? 'runSlam' : undefined, spatialSeat: positions[seat]!, spatialN: n }); // slow motion
    });
    // the rest of the table's cards: one quick cascade, a smaller row under the claimer's (from each player's spot)
    const others = props.slam.others ?? [];
    const m = others.length;
    others.forEach(({ seat: s2, card: c }, i) => {
      const base = trickSpot('bottom', n, i, jitterOf(c), trickScale);
      const sc = (trickScale ?? TRICK_SCALE) * 0.62;
      const w = CW * sc * 0.8;
      const perRow = Math.max(1, Math.ceil(m / 2));
      const row = Math.floor(i / perRow), col = i % perRow;
      const hc = CH * (trickScale ?? TRICK_SCALE), ho = CH * sc;
      // a row (two when many) just beyond the claimer's row, so the claimer's cards stay on top and readable
      const target: Xform = { ...base, s: sc, p: [(col - (Math.min(perRow, m - row * perRow) - 1) / 2) * w, base.p[1] * 0.8 + 0.002 * i, 0.02 - (hc * 0.55 + ho * 0.5) - row * ho * 0.92] };
      const leftHand = s2 === human ? departureSlot(held.current.slots, held.current.cards, c) : undefined;
      const from = leftHand ?? (s2 === human ? undefined : opponentFan(positions[s2]!, n, 0, 1));
      items.push({ key: `${handNo}-${c}`, card: c, public: true, target, from, origin: leftHand, delay: 0.38 + i * 0.03, duration: 0.18, arc: 0.25 });
    });
  }
  // opponents' fans
  for (let seat = 0; seat < n && !held0; seat++) {
    if (seat === human) continue;
    const c = handCounts[seat]!;
    for (let i = 0; i < c; i++) {
      items.push({ key: `${handNo}-b${seat}-${i}`, card: null, target: opponentFan(positions[seat]!, n, i, c), from: intro ? deck : undefined, delay: intro ? dealDelay(i, seat) : 0, holdUntilMove: intro, duration: tl.fly, arc: 0.3, sfxStart: 'deal', spatialSeat: positions[seat]!, spatialN: n });
    }
  }
  // the human hand
  const mine = held0 ? [] : myHand ?? Array.from({ length: handCounts[human]! }, () => null);
  const faceCount = mine.reduce((nCards, c) => nCards + (c ? 1 : 0), 0);
  // A card left since the last committed hand: slide the gap shut. A highlight alone does not.
  const closing = held.current.count > 0 && faceCount < held.current.count;
  // Off turn, legal is empty: every card stays flat and at full brightness.
  const yourTurn = legal.length > 0;
  // The meshes are the current hand. A deal beat must not leave a card out of this list.
  const fanCards = handOnFan(mine);
  const nextCards = new Set<string>();
  const nextSlots = new Map<string, Xform>();
  const nextSeen = new Set<string>();
  // A raised card slides its neighbours apart by 40% of a card width. The solver
  // reserves that room, and the same opts lay out every mesh and every hit quad.
  const selectedIndex = fanCards.findIndex((slot) => !!slot.card && slot.card === selected);
  const laid = selectedIndex >= 0 ? { ...fanOpts, spread: RAISE_SPREAD } : fanOpts;
  const fan = fanLayout(aspect, Math.max(1, fanCards.length), safeFrac, laid);
  const cardPx = fanCssPx(fan, screenW).width;
  const rawSpread = raiseSpreadPx(fanCards.length, selectedIndex, cardPx, fan.raiseOpen > 0 ? fan.raiseOpen : undefined);
  const nFan = fanCards.length;
  let spreadScale = 1;
  if (nFan > 1 && rawSpread.some((v) => v !== 0)) {
    const edgeQuad = (i: number) => cardScreenQuad(aspect, handFan(aspect, nFan, i, 0, safeFrac, laid, 0, screenH), screenW, screenH, 0, !!laid.short, view);
    const leftEdge = Math.min(...edgeQuad(0).map((p) => p.x));
    const rightEdge = Math.max(...edgeQuad(nFan - 1).map((p) => p.x));
    spreadScale = spreadFitScale(rawSpread, leftEdge, rightEdge, screenW, 1);
  }
  const spread = rawSpread.map((v) => v * spreadScale);
  const gaps = fanGapPx(fanCards.map((slot) => !!slot.card && legal.includes(slot.card))).map((g, i) => g + (spread[i] ?? 0));
  const handQuads: HandHitCard[] = [];
  let dealtIn = 0;
  fanCards.forEach((slot, i) => {
    const c = slot.card;
    const isLegal = !!c && legal.includes(c);
    // A face-down slot is not an illegal card. Only a real card you cannot play dims.
    const chrome = c
      ? handCardChrome({
        yourTurn, isLegal, selected: selected === c, marked: !!props.marked?.includes(c), anyIllegal: legal.length < fanCards.length,
      })
      : { pose: 'flat' as const, dim: false, glow: false };
    const pose = chrome.pose;
    const above = pose === 'legal' || pose === 'selected';
    // The raise is screen-up. Depth and render order (handDepthOpts, handRenderOrder) put a
    // raised card in front of the neighbours it overlaps, and the raycast uses that same order.
    const opts = { ...laid, ...handDepthOpts(pose) };
    const target = handFan(aspect, fanCards.length, i, 0, safeFrac, opts, gaps[i] ?? 0, screenH);
    // One shot. Later renders (a tap, a highlight) must not pass the face-down pose again.
    const flip = flipIn && flippedHand.current !== handNo && !!c;
    const id = c ? handCardKey(c) : '';
    const slotKey = handSlotKey(id, i);
    // Already in the hand: sit in the fan this frame. Flying in from the deck is what left
    // cards missing after the state had moved on, and those hidden meshes ignore taps.
    const dealIn = handDealsIn({ intro, dealing: !!props.dealing, flip });
    if (dealIn) dealtIn++;
    const move = fanMotion({ flip, fresh: dealIn, closing });
    const plane = handCardPlane(aspect, fanCards.length, i, 0, safeFrac, opts, gaps[i] ?? 0, screenH);
    const order = handRenderOrder(i, above, pose === 'selected');
    if (c) {
      nextCards.add(c);
      nextSlots.set(id, target);
      handQuads.push({
        id: c,
        order,
        poly: cardScreenQuad(aspect, target, screenW, screenH, posePx(pose), !!fanOpts.short, view),
      });
    }
    nextSeen.add(slotKey);
    if (c && c === props.dragCard) return;
    items.push({
      hand: true,
      key: handReactKey(handNo, c, i),
      card: c,
      target,
      // Fresh deal: leave the deck face down on this card's beat, turn face up on the way into the slot.
      from: move.kind === 'flip' ? flipped(target) : dealIn ? flipped(deck) : undefined,
      delay: move.kind === 'flip' ? i * 0.022 : dealIn ? dealDelay(i, human) : 0,
      holdUntilMove: slot.hidden || dealIn,
      sfxStart: dealIn ? 'deal' : undefined, spatialSeat: positions[human]!, spatialN: n,
      dim: chrome.dim,
      // No gold ring. A playable card is bright; a card you cannot play is dimmed in place.
      glow: false,
      cardId: c,
      // The id comes from the mesh that was hit. Fall back to this card only if the mesh has no stamp.
      tap: c && isLegal ? (hit: string) => onCardTap((hit || c) as Card) : pose === 'illegal' ? null : undefined,
      shadow: false,
      duration: move.kind === 'flip' ? 0.34 : move.kind === 'deal' ? tl.fly : move.kind === 'slide' ? GAP_S : handSpreadProbe(spreadSeconds()),
      motion: move.motion,
      arc: dealIn ? 0.3 : move.arc,
      raise: c ? raiseLocalY(pose, fan.viewH, screenH, fan.ch) : 0,
      roll: plane.roll,
      order,
    });
  });
  pendingHold.current = { handNo, cards: nextCards, slots: nextSlots, count: faceCount, seen: nextSeen };

  // Commit after paint. A highlight render and the server ack both read the previous hand, so they share keys
  // and the played card still knows the slot it left. Strict Mode's extra render sees the same snapshot.
  const showCards = props.fontsReady || resume;
  // Once this hand has been drawn in 3D, keep it through a painter restart. The felt fan
  // covers the frames before that. Neither gate may leave a hand that exists in state with nothing on screen.
  const handCount = myHand?.length ?? 0;
  const hand3D = showResumeHand3D(resume, handCount, nFaces, handCount > 0 && handLatched(handNo));
  if (hand3D && handCount > 0) latchHand(handNo);
  // The quads are the cards on screen this render. A tap reads them, not a mesh that
  // is still at the origin after a remount or still sitting in the un-raised slot.
  // A card still flying in is not a tap target.
  const dealingNow = intro && !!props.dealing;
  publishHandHits(hand3D && !dealingNow ? handQuads : []);
  useEffect(() => {
    const w = window as unknown as { __bwmDeal?: { handNo: number; held: boolean; dealing: boolean; hand: number; flying: number; hits: number } };
    w.__bwmDeal = { handNo, held: held0, dealing: dealingNow, hand: fanCards.length, flying: dealtIn, hits: hand3D && !dealingNow ? handQuads.length : 0 };
  });
  useEffect(() => () => { publishHandHits([]); }, []);
  useEffect(() => {
    if (!showCards) return;
    held.current = pendingHold.current;
  });
  useEffect(() => {
    const w = window as unknown as { __bwmHandMounts?: number };
    w.__bwmHandMounts = (w.__bwmHandMounts ?? 0) + 1;
  }, []);
  useEffect(() => {
    const w = window as unknown as { __bwmHandVis?: { state: number; webgl: number; nFaces: number; latched: boolean } };
    w.__bwmHandVis = { state: handCount, webgl: hand3D ? handCount : 0, nFaces, latched: handLatched(handNo) };
  });
  useLayoutEffect(() => {
    const live = props.onHandLive;
    // The flat fan leaves before paint once the 3D hand is in the tree. Two frames of both
    // left a second queen behind the one you tap, and the flat buttons took the hit.
    const on = flatFanHidden(hand3D, handCount);
    document.querySelector('.table-screen')?.classList.toggle('hand-3d', on);
    live?.(on);
    return () => { document.querySelector('.table-screen')?.classList.remove('hand-3d'); };
  }, [hand3D, handCount, props.onHandLive]);

  useEffect(() => {
    const keys = playShown.current.keys;
    for (const pl of shownTrick) keys.add(`${handNo}-${pl.card}`);
  });

  // test probe: every key that was ever dealt from the deck, per hand (a re-deal would add new keys)
  useEffect(() => {
    const w = window as unknown as { __bwmDealt?: Record<number, string[]> };
    const log = (w.__bwmDealt ??= {});
    const set = new Set(log[handNo] ?? []);
    for (const it of items) if (it.from === deck) set.add(it.key);
    log[handNo] = [...set];
  });

  if (faceHand.current !== handNo) {
    faceShown.current = new Set();
    faceHand.current = handNo;
  }
  const trickIds = shownTrick.map((p) => p.card);
  // Slam cards are public. Without this, a bot's Run it! lands on the back: those ids were never
  // in the viewer's hand, so the face set (hand + trick only) leaves the new mesh on the BWM back.
  const slamIds = props.slam ? [...props.slam.cards, ...(props.slam.others ?? []).map((o) => o.card)] : [];
  const ownIds = (myHand ?? []).filter((c): c is Card => !!c);
  const instant = [...trickIds, ...slamIds];
  // Paint your hand in this same render. A mesh must not mount on the BWM back and wait for the painter.
  for (const id of [...ownIds, ...instant]) face(id);
  const faceOrder = [...ownIds, ...instant];
  faceShown.current = visibleFaceIds(faceShown.current, faceOrder.slice(0, nFaces), ownIds, trickIds, slamIds);
  if (!showCards) return null;
  const shown = resumeDrawList(items, resume, extra);
  const drawn = hand3D ? shown : shown.filter((it) => !it.hand);
  const frontOf = (card: Card) => {
    // Trick and slam cards are public on the frame they land, even if a rebuild cleared the painter set.
    if (cardShowsFace(card, faceShown.current, instant)) return face(card);
    // A remount starts the painter over. The cached face stays; don't paint a back or a second texture.
    return peekFaceTexture(card, res, promoted(card));
  };
  return (
    <group>
      <LayoutProbe positions={positions} n={n} short={short} items={items} trickKeys={shownTrick.map((pl) => `${handNo}-${pl.card}`)} handKeys={hand3D ? mine.map((c, i) => handReactKey(handNo, c, i)) : []} />
      {drawn.map((it) => (
        <Card3D
          key={it.key}
          name={it.key}
          lit={props.lit}
          face={it.card ? frontOf(it.card) : null}
          back={back}
          target={it.target}
          from={it.from}
          origin={it.origin}
          slam={it.slam}
          delay={it.delay}
          duration={it.duration}
          motion={it.motion}
          arc={it.arc}
          raise={it.raise}
          roll={it.roll}
          order={it.order}
          dim={it.dim}
          glow={it.glow}
          castShadow={it.shadow !== false && quality === 'high'}
          quality={quality}
          cardId={it.cardId ?? it.card}
          onTap={it.tap}
          sfxStart={it.sfxStart}
          sfxLand={it.sfxLand}
          spatialSeat={it.spatialSeat}
          spatialN={it.spatialN}
          holdUntilMove={it.holdUntilMove}
          blast={it.hand ? 'hand' : 'table'}
        />
      ))}
      {wide && mine.length > 0 && <HandGlow aspect={aspect} count={mine.length} safeFrac={safeFrac} opts={fanOpts} />}
      {intro && <ShuffleDeck key={`shuffle-${handNo}`} at={deck} back={back} tl={tl} quality={quality} />}
    </group>
  );
}

/** A soft purple glow on a camera-space plane just behind the hand (desktop): makes your cards the focus. */
function HandGlow({ aspect, count, safeFrac, opts }: { aspect: number; count: number; safeFrac: number; opts: FanOpts }) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(128, 128, 4, 128, 128, 128);
    grd.addColorStop(0, 'rgba(185,128,255,0.55)');
    grd.addColorStop(0.45, 'rgba(140,80,230,0.22)');
    grd.addColorStop(1, 'rgba(140,80,230,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 128);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
  }, []);
  const xf = useMemo(() => {
    const cam = makeCamera(aspect, opts.short);
    const L = fanLayout(aspect, count, safeFrac, opts);
    const w = (count - 1) * L.step + L.cw * 2.2, h = L.ch * 1.25;
    const D = 1.02;
    const local = new Matrix4().compose(new Vector3(0, (-L.viewH / 2 + h / 2) * D, -D), new Quaternion(), new Vector3(w * D, h * D, 1));
    const m = cam.matrixWorld.clone().multiply(local);
    const p = new Vector3(), q = new Quaternion(), sc = new Vector3();
    m.decompose(p, q, sc);
    return { p, q, sc };
  }, [aspect, count, safeFrac, opts]);
  return (
    <mesh position={xf.p} quaternion={xf.q} scale={xf.sc} renderOrder={-1}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={tex} transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
    </mesh>
  );
}

/**
 * Publishes the *final* screen rects of the trick cards and the human hand (target transforms projected with the live
 * camera) on window.__bwmLayout, so UI tests can check that HTML overlays never cover them.
 */
function LayoutProbe({ items, trickKeys, handKeys, positions, n, short }: { items: { key: string; target: Xform }[]; trickKeys: string[]; handKeys: string[]; positions: SeatPos[]; n: number; short: boolean }) {
  const { camera, size } = useThree();
  useEffect(() => {
    const rect = (t: Xform) => {
      const m = new Matrix4().compose(new Vector3(...t.p), new Quaternion(...t.q), new Vector3(t.s, t.s, t.s));
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [cx, cy] of [[-CW / 2, -CH / 2], [CW / 2, -CH / 2], [CW / 2, CH / 2], [-CW / 2, CH / 2]] as const) {
        const v = new Vector3(cx, cy, 0).applyMatrix4(m).project(camera);
        const x = (v.x + 1) * size.width / 2, y = (1 - v.y) * size.height / 2;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    };
    const by = new Map(items.map((it) => [it.key, it.target]));
    const pick = (keys: string[]) => keys.map((k) => by.get(k)).filter((t): t is Xform => !!t).map(rect);
    // keyed by card too (tips draw rings / tags over specific cards: the led card, your trumps, …)
    const keyed = (keys: string[]) => keys.flatMap((k) => { const t = by.get(k); const card = k.slice(k.indexOf('-') + 1); return t && !card.startsWith('hb-') ? [{ card, ...rect(t) }] : []; });
    (window as unknown as { __bwmLayout: unknown }).__bwmLayout = { w: size.width, h: size.height, trick: pick(trickKeys), hand: pick(handKeys), trickCards: keyed(trickKeys), handCards: keyed(handKeys),
      // every seat's trick slot, played yet or not (the layout check keeps name plates off all of them)
      slots: short ? [] : trickRects(camera, size, positions, n).map((r) => ({ x: r.left + 4, y: r.top + 4, w: r.right - r.left - 8, h: r.bottom - r.top - 8 })) };
  });
  return null;
}

/** venues: a soft neutral light riding with the camera, so your hand reads the same in every venue (the venue's own
 * light and HDRI can be dim or coloured: amber speakeasy, night rooftop). Short range: it never reaches the table. */
function HandFill() {
  const ref = useRef<import('three').PointLight>(null);
  const camera = useThree((st) => st.camera);
  useFrame(() => { ref.current?.position.copy(camera.position).add(_up); });
  return <pointLight ref={ref} color="#fff8f0" intensity={2.4} distance={2.6} decay={2} />;
}
const _up = new Vector3(0, 0.25, 0);

function Lights({ quality, def, shadowSize }: { quality: 'high' | 'low'; def: VenueDef; shadowSize: number }) {
  const hi = quality === 'high';
  const cast = hi && shadowSize > 0;
  return (
    <>
      <ambientLight intensity={hi ? 0.15 : 0.55} />
      <hemisphereLight args={[def.sky, def.ground, hi ? 0.35 : 0.8]} />
      <spotLight
        position={[0.4, 5.2, 1.2]}
        angle={0.62}
        penumbra={0.85}
        intensity={(hi ? 70 : 55) * def.keyK}
        decay={2}
        color={def.key}
        castShadow={cast}
        shadow-mapSize={[Math.max(shadowSize, 256), Math.max(shadowSize, 256)]}
        shadow-bias={-0.00012}
        shadow-normalBias={0.012}
        shadow-radius={6}
      />
      {/* Classic used to skip this. The spotlight falls off at the near edge, so the hand
          rendered grey while the quick-load cards stayed white. Every venue gets the fill. */}
      <HandFill />
      {/* purple rim from behind the table, for the stream-studio vibe */}
      <pointLight position={[0, 1.6, -4.2]} intensity={(hi ? 9 : 6) * (def.id === 'classic' ? 1 : 0.6)} color={def.rim} distance={9} />
    </>
  );
}

/** screen rects (CSS px) of every seat's trick-card slot, as the camera sees them now */
const _tm = new Matrix4(), _tv = new Vector3();
function trickRects(camera: Camera, size: { width: number; height: number }, positions: SeatPos[], n: number) {
  return positions.map((pos) => {
    const t = trickSpot(pos, n, 0, 0);
    _tm.compose(new Vector3(...t.p), new Quaternion(...t.q), new Vector3(t.s, t.s, t.s));
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      _tv.set((cx * CW) / 2, (cy * CH) / 2, 0).applyMatrix4(_tm).project(camera);
      const x = (_tv.x + 1) * size.width / 2, y = (1 - _tv.y) * size.height / 2;
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    // a little slack for the per-card jitter (a few degrees of yaw)
    return { left: left - 4, right: right + 4, top: top - 4, bottom: bottom + 4 };
  });
}

function Badges({ positions, n, human, renderSeat, portal, safeFrac, short, safe }: Pick<SceneProps, 'positions' | 'n' | 'human' | 'renderSeat'> & { portal: RefObject<HTMLDivElement>; safeFrac: number; short: boolean; safe: { l: number; r: number; t: number; b: number } }) {
  const invalidate = useThree((st) => st.invalidate);
  return (
    <>
      {positions.map((p, seat) => {
        if (seat === human) return null;
        const side = p === 'left' || p === 'right' ? p : p === 'top' ? 'top' : null;
        // phone landscape: plates pinned to the screen edges at mid-height, partner top-centre under the scorebug
        if (short && side) {
          const cls = side === 'top' ? 'side-topc' : `side-${side}`;
          // top seat: left edge just right of the fan (badgeSpot sits beside it), so no card peeks out under the plate
          const calcShort = (el: Object3D, camera: Camera, size: { width: number; height: number }) =>
            side === 'top' ? [Math.min(size.width - 200, (new Vector3().setFromMatrixPosition(el.matrixWorld).project(camera).x + 1) * size.width / 2), 50 + safe.t] : side === 'left' ? [8 + safe.l, size.height * (n === 3 ? 0.36 : 0.43)] : [size.width - 8 - safe.r, size.height * (n === 3 ? 0.36 : 0.43)];
          return (
            <Html key={seat} position={badgeSpot(p, n)} calculatePosition={calcShort} zIndexRange={[5, 0]} className={`seat-anchor ${cls}`} portal={portal}>
              {renderSeat(seat)}
            </Html>
          );
        }
        // side plates are anchored by their outer edge and clamped inside the viewport (+ iOS safe area)
        const calc = side
          ? (el: Object3D, camera: Camera, size: { width: number; height: number }) => {
            const v = new Vector3().setFromMatrixPosition(el.matrixWorld).project(camera);
            const x = (v.x + 1) * size.width / 2, y = (1 - v.y) * size.height / 2;
            const pad = 6 + safeFrac * size.width;
            if (side === 'top') {
              // left-anchored; measured (plate + video bubble) so it stays clear of the right edge and below the trump strip
              const plate = portal.current?.querySelector<HTMLElement>('.seat-anchor.side-top > .plate');
              const pr = plate?.getBoundingClientRect();
              const br = plate?.querySelector('.vbubble')?.getBoundingClientRect();
              const pw = pr ? Math.max(pr.right, br?.right ?? 0) - Math.min(pr.left, br?.left ?? Infinity) : 190;
              const ph = pr ? Math.max(pr.height, br?.height ?? 0) : 56;
              const sr = document.querySelector('.trump-strip')?.getBoundingClientRect();
              const bug = document.querySelector('.scorebug .bug')?.getBoundingClientRect();
              const bar = sr && sr.height > 0 ? sr.bottom : bug ? bug.bottom : size.width >= 900 ? 106 : 122; // the strip folds into the bug on cramped phones
              const left = br && pr ? Math.max(0, pr.left - br.left) : 0;
              // the "TO PLAY" tag / bubble can reach above the plate: keep all of it under the bar
              const tr = plate?.querySelector('.plate-turn')?.getBoundingClientRect();
              const up = pr ? Math.max(ph / 2, (pr.top + pr.bottom) / 2 - Math.min(pr.top, br && br.height ? br.top : Infinity, tr && tr.height ? tr.top : Infinity)) : ph / 2;
              const minY = bar + 8 + up;
              let cy = Math.max(y, minY);
              // and keep clear of the side plates below it (big video bubbles on small phones)
              const sideEls = [...(portal.current?.querySelectorAll<HTMLElement>('.seat-anchor.side-left > .plate, .seat-anchor.side-right > .plate') ?? [])];
              const sides = sideEls.map((e) => e.getBoundingClientRect().top).filter((t) => t > 0);
              if (sides.length) cy = Math.max(minY, Math.min(cy, Math.min(...sides) - 6 - ph / 2));
              // a side plate had to move out of the trick zone (small phones): the top plate stays as high as it can, so the two
              // don't chase each other (the side plate may be tucked right under this one)
              if (sideEls.some((e) => e.dataset.moved === '1')) cy = minY;
              return [Math.max(pad + left, Math.min(x, size.width - pad - pw + left)), cy];
            }
            const ax = side === 'left' ? Math.max(pad, x - 72) : Math.min(size.width - pad, x + 72);
            // never cover a trick slot (phones in portrait: the side plates sit right beside the trick cards).
            // 1) if the plate would reach into a slot beside it, it goes narrow (chips wrap under the name);
            // 2) if it still touches one, it moves up, clear of the trick zone (never above the top bar).
            const plate = portal.current?.querySelector<HTMLElement>(`.seat-anchor.side-${side} > .plate`);
            const pr = plate?.getBoundingClientRect();
            if (!plate || !pr || !pr.width) return [ax, y];
            const slots = trickRects(camera, size, positions, n);
            const narrow = plate.classList.contains('narrow');
            if (!narrow) plate.dataset.wideW = String(pr.width);
            const wideW = Number(plate.dataset.wideW) || pr.width;
            const hits = (w: number, h: number, cy: number) => {
              const l = side === 'left' ? ax : ax - w, r = l + w;
              return slots.filter((t) => r + 6 > t.left && l - 6 < t.right && cy + h / 2 + 6 > t.top && cy - h / 2 - 6 < t.bottom);
            };
            const wantNarrow = hits(wideW, pr.height, y).length > 0;
            if (wantNarrow !== narrow) { plate.classList.toggle('narrow', wantNarrow); invalidate(); } // re-measured next frame
            const pw = pr.width, ph = pr.height;
            if (!hits(pw, ph, y).length) { delete plate.dataset.moved; return [ax, y]; }
            plate.dataset.moved = '1';
            const sr = document.querySelector('.trump-strip')?.getBoundingClientRect();
            const bar = sr && sr.height > 0 ? sr.bottom : document.querySelector('.scorebug .bug')?.getBoundingClientRect().bottom ?? 0;
            // everything else the plate must not cover: the other plates, the controls, the last trick, chat, your plate
            const hud = [...document.querySelectorAll<HTMLElement>(`.seat-anchor:not(.side-${side}) > .plate, .seat-anchor:not(.side-${side}) > .plate .vbubble, .ctl-cluster, .last-trick, .chat-toggle, .me-plate, .me-plate .plate-turn, .me-plate .vbubble, .center-note`)]
              .map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
            const area = (a: { left: number; right: number; top: number; bottom: number }, b: { left: number; right: number; top: number; bottom: number }) =>
              Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
            const cost = (px: number, cy: number) => {
              const l = side === 'left' ? px : px - pw;
              const box = { left: l - 6, right: l + pw + 6, top: cy - ph / 2 - 6, bottom: cy + ph / 2 + 6 };
              const real = { left: l, right: l + pw, top: cy - ph / 2, bottom: cy + ph / 2 };
              const off = cy - ph / 2 < bar + 4 || cy + ph / 2 > size.height - 4 ? 1e9 : 0;
              // a real overlap costs far more than only crowding the 6 px breathing room
              return off + slots.reduce((a, t) => a + area(real, t) * 400 + area(box, t) * 10, 0) + hud.reduce((a, r) => a + area(real, r) * 40 + area(box, r), 0);
            };
            // candidates: just above the trick zone, just below it, and below it but slid in from the edge (clear of the controls)
            const hit = hits(pw, ph, y);
            const up = Math.min(...hit.map((t) => t.top)) - 6 - ph / 2;
            let down = Math.max(...hit.map((t) => t.bottom)) + 6 + ph / 2;
            for (let k = 0; k < 4; k++) { const more = hits(pw, ph, down); if (!more.length) break; down = Math.max(...more.map((t) => t.bottom)) + 6 + ph / 2; }
            const inward = (cy: number) => {
              let px = ax;
              for (const r of hud) if (r.top < cy + ph / 2 + 6 && r.bottom > cy - ph / 2 - 6) px = side === 'left' ? Math.max(px, r.right < size.width / 2 ? r.right + 6 : px) : Math.min(px, r.left > size.width / 2 ? r.left - 6 : px);
              // never past the middle: a seat's plate stays on that seat's side of the table
              return side === 'left' ? Math.min(px, size.width / 2 - pw) : Math.max(px, size.width / 2 + pw);
            };
            const cands: [number, number][] = [[ax, up], [ax, down], [inward(down), down], [inward(up), up], [ax, y]];
            // small phones: right under the partner's plate (top band), when that's the only gap above the trick zone
            const tpEl = portal.current?.querySelector<HTMLElement>('.seat-anchor.side-top > .plate');
            const tpr = tpEl?.getBoundingClientRect();
            // the partner's plate and its video bubble (the big circle hangs below the plate)
            const tbr = tpEl?.querySelector('.vbubble')?.getBoundingClientRect();
            const tp = tpr && tpr.width > 0 ? { top: tpr.top, bottom: Math.max(tpr.bottom, tbr?.bottom ?? 0) } : undefined;
            if (tp) {
              cands.push([ax, tp.bottom + 6 + ph / 2]);
              // tucked under the plate body when this plate is clear of the (round) bubble sideways
              const l = side === 'left' ? ax : ax - pw, r = l + pw;
              if (tpr && tbr && (r + 6 <= tbr.left || l - 6 >= tbr.right)) cands.push([ax, tpr.bottom + 6 + ph / 2]);
            }
            let best = cands[0]!, bc = Infinity;
            for (const c of cands) { const k = cost(c[0], c[1]); if (k < bc) { bc = k; best = c; } }
            const w = window as unknown as { __bwmPlateDbg?: Record<string, unknown>; __bwmLayout?: unknown };
            const dbg = w.__bwmLayout ? (w.__bwmPlateDbg ??= {}) : undefined;
            if (dbg) dbg[side] = { y, pw, ph, tp: tp && [tp.top, tp.bottom], cands: cands.map((c) => [...c.map(Math.round), Math.round(cost(c[0], c[1]))]), slots: slots.map((t) => [t.left, t.top, t.right, t.bottom].map(Math.round)) };
            return best;
          }
          : undefined;
        return (
          <Html key={seat} position={badgeSpot(p, n)} center={!side} calculatePosition={calc} zIndexRange={[5, 0]} className={`seat-anchor${side ? ` side-${side}` : ''}`} portal={portal}>
            {renderSeat(seat)}
          </Html>
        );
      })}
    </>
  );
}

/**
 * The resumed table is playable before any of this finishes. Each program is linked on its own frame,
 * then the shadow map grows. The end state is the iPhone look: 1k maps, clearcoat, sheen, 1.75×,
 * soft 2048 shadows, and the hall.
 */
function ResumeRamp({ quality, def, onShow, onLit, onDpr, onShadow, onHall }: { quality: 'high' | 'low'; def: VenueDef; onShow: () => void; onLit: () => void; onDpr: (n: number) => void; onShadow: (n: number) => void; onHall: () => void }) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    let alive = true;
    const hi = quality === 'high';
    const white = flatTex([255, 255, 255, 255], true);
    const table = buildTableMaterials(def, quality);
    const card = createLitCardMaterial(white, quality, true);
    const cardDim = createLitCardMaterial(white, quality, true);
    if (cardDim instanceof MeshPhysicalMaterial) { cardDim.clearcoat = 0.05; cardDim.sheen = 0; }
    const cardBack = createLitCardMaterial(white, quality, false);
    const basics: Material[] = [
      new MeshBasicMaterial({ name: 'basic-color', color: def.felt }),
      new MeshBasicMaterial({ name: 'basic-stripe', color: '#d9b04a', transparent: true, opacity: 0.35, depthWrite: false }),
      new MeshBasicMaterial({ name: 'basic-map', map: white }),
      new MeshBasicMaterial({ name: 'basic-logo', map: white, transparent: true, opacity: 0.13, depthWrite: false }),
      // Same program as the per-card gold ring: opaque, tone mapping off, no depth write.
      new MeshBasicMaterial({ name: 'basic-gold', color: '#f5c542', depthWrite: false, toneMapped: false }),
      new MeshStandardMaterial({ name: 'edge', color: '#efe9dc', roughness: 0.75 }),
    ];
    table.felt.name = 'felt';
    table.wood.name = 'wood';
    table.apron.name = 'apron';
    table.floor.name = 'floor';
    card.name = 'card';
    cardDim.name = 'card-dim';
    cardBack.name = 'card-back';
    const litMats = [table.felt, table.wood, table.apron, table.floor, card, cardDim, cardBack];
    void (async () => {
      await nextFrame();
      if (!alive) return;
      // One resize, while the scene is still empty. Stepping the buffer later reallocated an MSAA
      // surface on every stop and each of those was its own long task.
      if (hi) {
        onDpr(1.75);
        await nextFrame();
        await nextFrame();
      }
      if (!alive) return;
      for (const m of basics) {
        if (!alive) return;
        await forceProgram(gl, camera, m, scene);
      }
      if (!alive) return;
      onShow();
      // Let the solid table paint before the next link.
      await nextFrame();
      await nextFrame();
      for (const m of litMats) {
        if (!alive) return;
        await forceProgram(gl, camera, m, scene);
      }
      if (!alive) return;
      onLit();
      await nextFrame();
      await nextFrame();
      if (!hi) { onHall(); return; }
      const spots: { castShadow: boolean; shadow: { mapSize: { set: (x: number, y: number) => void } } }[] = [];
      scene.traverse((o) => {
        const light = o as unknown as { isSpotLight?: boolean; castShadow: boolean; shadow: { mapSize: { set: (x: number, y: number) => void } } };
        if (light.isSpotLight) spots.push(light);
      });
      for (const m of litMats) {
        if (!alive) return;
        await forceProgram(gl, camera, m, scene, undefined, () => {
          // On only while this program links, so a visible frame cannot compile every shadow variant at once.
          gl.shadowMap.enabled = true;
          gl.shadowMap.type = PCFSoftShadowMap;
          for (const light of spots) { light.castShadow = true; light.shadow.mapSize.set(256, 256); }
          return () => {
            gl.shadowMap.enabled = false;
            for (const light of spots) light.castShadow = false;
          };
        });
      }
      if (!alive) return;
      for (const size of [256, 512, 1024, 2048]) {
        if (!alive) return;
        onShadow(size);
        await nextFrame();
        await nextFrame();
      }
      if (alive) onHall();
    })();
    return () => { alive = false; };
  }, [quality, def, gl, camera, scene, onShow, onLit, onDpr, onShadow, onHall]);
  return null;
}

function HallAttach({ active }: { active: boolean }) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const onMap = useCallback((tex: Texture) => {
    void (async () => {
      const dummy = new ThreeScene();
      dummy.environment = tex;
      dummy.fog = scene.fog;
      const lights: Object3D[] = [];
      scene.traverse((o) => { if ((o as { isLight?: boolean }).isLight) lights.push(o); });
      for (const light of lights) dummy.add(light.clone());
      const mats = new Set<Material>();
      scene.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh || !mesh.material) return;
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of list) if ((m as MeshStandardMaterial).isMeshStandardMaterial) mats.add(m);
      });
      for (const m of mats) {
        if (!dummy.environment) return;
        await forceProgram(gl, camera, m, dummy);
      }
      scene.environment = tex;
      scene.background = tex;
      scene.backgroundBlurriness = 0.55;
      scene.backgroundIntensity = 0.22;
      scene.environmentIntensity = 0.55;
      invalidate();
    })();
  }, [gl, camera, scene, invalidate]);
  return <ClassicHall active={active} onMap={onMap} />;
}

/** Hand taps resolve against the quads Cards published this render, before the raycaster. */
function HandPointer({ onTap, onDrop, legal, onDragging, view = 'standing', turnUp = false }: { onTap: (card: Card) => void; onDrop?: (card: Card, slam?: number, rel?: [number, number]) => void; legal: readonly Card[]; onDragging: (card: Card | null) => void; view?: 'standing' | 'sitting'; turnUp?: boolean }) {
  const dragging = useRef(onDragging);
  dragging.current = onDragging;
  const gl = useThree((s) => s.gl);
  const tap = useRef(onTap);
  tap.current = onTap;
  const drop = useRef(onDrop);
  drop.current = onDrop;
  const legalNow = useRef(legal);
  legalNow.current = legal;
  // The pointer effect below subscribes once ([gl]); read the LIVE view/Turn Up through refs so
  // toggling Turn Up (or Sit/Stand) mid-game gates the very next drag, not the value at mount.
  const viewNow = useRef(view);
  viewNow.current = view;
  const turnUpNow = useRef(turnUp);
  turnUpNow.current = turnUp;
  useLayoutEffect(() => {
    const el = gl.domElement;
    // Drag-to-play: the press still selects (first tap). Past 10px a lifted copy of the card follows the
    // finger on top of everything; release over the felt plays it, anywhere else it snaps back.
    let drag: { id: Card; x0: number; y0: number; on: boolean; ghost: HTMLCanvasElement | null; w: number; h: number; top: number; trail: DragSample[]; legal: boolean } | null = null;
    const endGhost = (g: HTMLCanvasElement | null, cls: string, ms: number, to?: { x: number; y: number }) => {
      if (!g) return;
      g.classList.add(cls);
      if (to) { g.style.left = `${to.x}px`; g.style.top = `${to.y}px`; }
      window.setTimeout(() => g.remove(), ms);
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
      if (!drag.on && !dragStarted(dx, dy)) return;
      e.preventDefault();
      if (!drag.on) {
        drag.on = true;
        el.style.touchAction = 'none';
        const g = paintFace(drag.id, 200, 280, false);
        g.className = 'drag-ghost';
        g.dataset.testid = 'drag-ghost';
        g.style.width = `${drag.w}px`;
        g.style.height = `${drag.h}px`;
        document.body.appendChild(g);
        drag.ghost = g;
        dragging.current(drag.id);
        (window as unknown as { __bwmDrag?: string }).__bwmDrag = `drag:${drag.id}`;
      }
      drag.trail.push({ t: e.timeStamp || performance.now(), x: e.clientX, y: e.clientY });
      if (drag.trail.length > 80) drag.trail.shift();
      const g = drag.ghost!;
      g.style.left = `${e.clientX - drag.w / 2}px`;
      g.style.top = `${e.clientY - drag.h * 0.7}px`;
    };
    const finish = (e: PointerEvent) => {
      const d = drag;
      drag = null;
      el.style.touchAction = '';
      if (!d?.on) return;
      e.preventDefault();
      // Legal at press time or now: a legal card never shakes (the legal list can re-render mid-drag).
      const result = dropResult({ legal: d.legal || legalNow.current.includes(d.id), y: e.clientY, handTop: d.top, screenH: window.innerHeight });
      (window as unknown as { __bwmDrag?: string }).__bwmDrag = `${result}:${d.id}`;
      if (result === 'play') {
        d.trail.push({ t: e.timeStamp || performance.now(), x: e.clientX, y: e.clientY });
        const v = releaseVelocity(d.trail);
        const intensity = dragSlamIntensity(d.trail, viewNow.current, turnUpNow.current);
        const rect = el.getBoundingClientRect();
        // The 3D card takes over at the finger point (card centre), so the copy can go at once.
        noteDrop({ card: d.id, x: e.clientX - rect.left, y: e.clientY - d.h * 0.2 - rect.top, intensity, at: performance.now() });
        (window as unknown as { __bwmSlam?: { v: number; intensity: number } }).__bwmSlam = { v, intensity };
        endGhost(d.ghost, 'played', 60);
        drop.current?.(d.id, intensity, releaseVector(d.trail));
        // Keep the slot in the fan empty until the play lands in state, so the card never reappears in the hand.
        window.setTimeout(() => dragging.current(null), 900);
        return;
      }
      dragging.current(null);
      if (result === 'shake') endGhost(d.ghost, 'shake', 380);
      else endGhost(d.ghost, 'snap', 220, { x: d.x0 - d.w / 2, y: d.y0 - d.h * 0.7 });
    };
    const noScroll = (e: TouchEvent) => { if (drag?.on) e.preventDefault(); };
    const down = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const id = pickHandCard(e.clientX - rect.left, e.clientY - rect.top);
      if (!id) return;
      e.stopPropagation();
      e.preventDefault();
      const hits = publishedHandHits();
      const me = hits.find((h) => h.id === id);
      const side = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(b.x - a.x, b.y - a.y);
      const w = me ? side(me.poly[0]!, me.poly[1]!) : 60;
      const top = hits.length ? Math.min(...hits.flatMap((h) => h.poly.map((p) => p.y))) + rect.top : window.innerHeight * 0.7;
      drag = { id: id as Card, x0: e.clientX, y0: e.clientY, on: false, ghost: null, w, h: w * 1.4, top, trail: [{ t: e.timeStamp || performance.now(), x: e.clientX, y: e.clientY }], legal: legalNow.current.includes(id as Card) };
      if (echoTap(e, id)) {
        (window as unknown as { __bwmLastTap?: string }).__bwmLastTap = `echo:${id}`;
        return;
      }
      (window as unknown as { __bwmLastTap?: string }).__bwmLastTap = `${id}@${e.clientX.toFixed(0)},${e.clientY.toFixed(0)}`;
      tap.current(id as Card);
    };
    const up = (e: PointerEvent) => { noteTapUp(); finish(e); };
    window.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('touchmove', noScroll, { passive: false });
    el.addEventListener('pointerdown', down, true);
    el.addEventListener('pointerup', up, true);
    el.addEventListener('pointercancel', up, true);
    window.addEventListener('pointerup', up, true);
    return () => {
      el.removeEventListener('pointerdown', down, true);
      el.removeEventListener('pointerup', up, true);
      el.removeEventListener('pointercancel', up, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointermove', move);
      document.removeEventListener('touchmove', noScroll);
    };
  }, [gl]);
  return null;
}

export default function Scene(props: SceneProps) {
  const [fontsReady, setFontsReady] = useState(false);
  const [aspect, setAspect] = useState(() => window.innerWidth / window.innerHeight);
  useEffect(() => {
    let alive = true;
    Promise.race([
      Promise.all([document.fonts.load('800 40px "Barlow Condensed"'), document.fonts.load('700 40px "Barlow Condensed"')]),
      new Promise((r) => setTimeout(r, 1500)),
    ]).then(() => alive && setFontsReady(true));
    return () => { alive = false; };
  }, []);
  const safeFrac = useSafeFrac();
  const hi = props.quality === 'high';
  const badgeLayer = useRef<HTMLDivElement>(null!);
  const tableGroup = useRef<Group>(null);
  const [layerReady, setLayerReady] = useState(false);
  const def = VENUE_DEFS[props.venue ?? 'classic'];
  const classic = def.id === 'classic';
  const barbershop = def.id === 'barbershop';
  const rooftop = def.id === 'rooftop';
  const yacht = def.id === 'yacht';
  const beach = def.id === 'beach';
  const backyard = def.id === 'backyard';
  const church = def.id === 'church';
  const vegas = def.id === 'vegas';
  const speakeasy = def.id === 'speakeasy';
  const grandma = def.id === 'grandma';
  const mansion = def.id === 'mansion';
  const cubeRoom = barbershop || rooftop || yacht || beach || backyard || church || vegas || speakeasy || grandma || mansion;
  const [showTable, setShowTable] = useState(false);
  const [lit, setLit] = useState(false);
  const [shadowSize, setShadowSize] = useState(0);
  const [dprCap, setDprCap] = useState(1);
  const [textured, setTextured] = useState(false);
  const [hallGo, setHallGo] = useState(false);
  // Drag-to-play: the card under the finger is drawn by the lifted copy, so its slot in the fan is left open.
  const [dragCard, setDragCard] = useState<Card | null>(null);
  const onTableReady = props.onTableReady;
  const tableReady = useCallback(() => { onTableReady?.(); }, [onTableReady]);
  const onShow = useCallback(() => setShowTable(true), []);
  const onLit = useCallback(() => setLit(true), []);
  const onDressed = props.onTableDressed;
  const onTextured = useCallback(() => { setTextured(true); onDressed?.(); }, [onDressed]);
  const onDpr = useCallback((n: number) => setDprCap(n), []);
  const onShadow = useCallback((n: number) => setShadowSize(n), []);
  const onHall = useCallback(() => setHallGo(true), []);
  useEffect(() => { setLayerReady(true); }, []);
  return (
    <div className="table-canvas-wrap">
    <Canvas
      className="table-canvas"
      frameloop="demand"
      shadows={shadowSize > 0 ? 'soft' : false}
      dpr={hi ? [1, dprCap] : 1}
      gl={{ antialias: hi, powerPreference: 'high-performance', toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      camera={{ fov: 50, near: 0.05, far: 60, position: [0, 4, 3.5] }}
      onCreated={({ gl, size }) => {
        quietShaderErrors(gl);
        const w = window as unknown as { __bwmParallelShaders?: boolean };
        w.__bwmParallelShaders = gl.extensions.has('KHR_parallel_shader_compile');
        setAspect(size.width / size.height);
      }}
      onPointerMissed={() => props.onFeltTap?.()}
      events={(store) => {
        const base = r3fEvents(store);
        return {
          ...base,
          compute(event, state) {
            const ndc = pointerNdc(event, state.gl.domElement.getBoundingClientRect(), state.size);
            state.pointer.set(ndc.x, ndc.y);
            state.raycaster.setFromCamera(state.pointer, state.camera);
          },
          filter: (hits) => hitsInPaintOrder(hits),
        };
      }}
      resize={{ debounce: 50 }}
    >
      <AspectWatcher onAspect={setAspect} />
      <EffectWarmup quality={props.quality} />
      <SnapHook />
      <CameraRig view={props.view} />
      <FxShake table={tableGroup} />
      <color attach="background" args={[def.clear]} />
      {classic && <fog attach="fog" args={['#0c0712', 7, 16]} />}
      <Lights quality={props.quality} def={def} shadowSize={shadowSize} />
      {/* The hall is filtered one mip per frame, and only after the cloth maps are on the table.
          drei's <Preload all> stays out: it compiled and rendered a cube camera inside useLayoutEffect. */}
      <ResumeRamp quality={props.quality} def={def} onShow={onShow} onLit={onLit} onDpr={onDpr} onShadow={onShadow} onHall={onHall} />
      {hi && classic && <HallAttach active={hallGo && textured} />}
      {!classic && !cubeRoom && textured && <Venue3D key={def.id} def={def} quality={props.quality} reduceFx={!!props.reduceFx} />}
      {classic && textured && <ClassicStudio quality={props.quality} />}
      {barbershop && textured && <BarbershopRoom quality={props.quality} handNo={props.handNo} />}
      {rooftop && textured && <RooftopRoom quality={props.quality} handNo={props.handNo} />}
      {yacht && textured && <YachtRoom quality={props.quality} handNo={props.handNo} />}
      {beach && textured && <BeachRoom quality={props.quality} handNo={props.handNo} />}
      {backyard && textured && <BackyardRoom quality={props.quality} handNo={props.handNo} />}
      {church && textured && <ChurchRoom quality={props.quality} handNo={props.handNo} />}
      {vegas && textured && <VegasRoom quality={props.quality} handNo={props.handNo} />}
      {speakeasy && textured && <SpeakeasyRoom quality={props.quality} handNo={props.handNo} />}
      {grandma && textured && <GrandmaRoom quality={props.quality} handNo={props.handNo} />}
      {mansion && textured && <MansionRoom quality={props.quality} handNo={props.handNo} />}
      {showTable && (
        <group
          ref={tableGroup}
          onPointerDown={(e) => {
            if (cardIdFromHit(e.object)) return;
            e.stopPropagation();
            props.onFeltTap?.();
          }}
        >
          <TableModel quality={props.quality} lit={lit} onReady={tableReady} onTextured={onTextured} def={def} />
        </group>
      )}
      {showTable && props.positions.map((p, seat) => <TurnRing key={seat} pos={p} n={props.n} active={props.turnSeat === seat} />)}
      {showTable && <Cards {...props} dragCard={dragCard} aspect={aspect} fontsReady={fontsReady} safeFrac={safeFrac} lit={lit} />}
      {showTable && <HandPointer onTap={props.onCardTap} onDrop={props.onCardDrop} legal={props.legal} onDragging={setDragCard} view={props.view} turnUp={props.turnUp} />}
      <AfterTable quality={props.quality} tableUp={textured} />
      {layerReady && <Badges positions={props.positions} n={props.n} human={props.human} renderSeat={props.renderSeat} portal={badgeLayer} safeFrac={safeFrac} short={!!props.short} safe={props.safe ?? { l: 0, r: 0, t: 0, b: 0 }} />}
    </Canvas>
    <div ref={badgeLayer} className="badge-layer" />
    </div>
  );
}

/** Hands the table renderer to the effect warm so tornado shaders link before the loading screen lifts. */
function EffectWarmup({ quality }: { quality: 'high' | 'low' }) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  useEffect(() => { offerTableRenderer(gl, camera, quality); }, [gl, camera, quality]);
  return null;
}

/**
 * Nuke and Run it! shaders, including the postprocessing library, load only after the felt is up.
 * They are not on the reload path: a cold open used to download and compile them before the table could paint.
 */
function AfterTable({ quality, tableUp }: { quality: 'high' | 'low'; tableUp: boolean }) {
  const [nuke, setNuke] = useState<typeof import('./Nuke3D') | null>(null);
  const [tornado, setTornado] = useState<typeof import('./Tornado3D') | null>(null);
  useEffect(() => {
    if (!tableUp) return;
    let alive = true;
    const start = () => {
      // A deploy can delete the hashed file this page still names. Retry, then reload once.
      void importChunk(() => import('./Nuke3D')).then((m) => { if (alive) setNuke(m); }, () => {});
      void importChunk(() => import('./Tornado3D')).then((m) => { if (alive) setTornado(m); }, () => {});
    };
    // Idle, after the cloth is on: the nuke shaders are not part of dealing a resumed hand back in.
    const ric = (window as unknown as { requestIdleCallback?: (fn: () => void, opts?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }).requestIdleCallback;
    const cancel = (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
    const id = ric ? ric(start, { timeout: 2500 }) : window.setTimeout(start, 800);
    return () => { alive = false; if (ric && cancel) cancel(id as number); else clearTimeout(id as number); };
  }, [tableUp]);
  if (!nuke && !tornado) return null;
  return (
    <>
      {nuke && <nuke.NukeGlRecovery />}
      {nuke && <nuke.NukeGuard><nuke.Nuke3D quality={quality} /></nuke.NukeGuard>}
      {tornado && <tornado.Tornado3D quality={quality} />}
    </>
  );
}

function AspectWatcher({ onAspect }: { onAspect: (a: number) => void }) {
  const size = useThree((s) => s.size);
  useEffect(() => { onAspect(size.width / size.height); }, [size, onAspect]);
  return null;
}

/** Largest horizontal iOS safe-area inset (notch / home indicator in landscape) as a fraction of the viewport width. */
function useSafeFrac(): number {
  const [frac, setFrac] = useState(0);
  useEffect(() => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding-left:env(safe-area-inset-left,0px);padding-right:env(safe-area-inset-right,0px)';
    document.body.appendChild(probe);
    const read = () => {
      const cs = getComputedStyle(probe);
      const inset = Math.max(parseFloat(cs.paddingLeft) || 0, parseFloat(cs.paddingRight) || 0);
      setFrac(window.innerWidth > 0 ? inset / window.innerWidth : 0);
    };
    read();
    window.addEventListener('resize', read);
    window.addEventListener('orientationchange', read);
    return () => { window.removeEventListener('resize', read); window.removeEventListener('orientationchange', read); probe.remove(); };
  }, []);
  return frac;
}

/**
 * The dealer's deck: splits into two halves and riffles together while the shuffle sound plays, squares up,
 * then shrinks as the cards fly out (each dealt card makes its own flick sound as it leaves — see Card3D sfxStart).
 */
function ShuffleDeck({ at, back, tl, quality }: { at: Xform; back: Texture; tl: DealTimeline; quality: 'high' | 'low' }) {
  const N = 14;
  const group = useRef<Group>(null);
  const cards = useRef<(Mesh | null)[]>([]);
  const t0 = useRef<number | null>(null);
  const invalidate = useThree((s) => s.invalidate);
  const geo = useMemo(() => cardGeometry(), []);
  const mat = useMemo(() => (quality === 'high' ? new MeshPhysicalMaterial({ map: back, roughness: 0.45, clearcoat: 0.3 }) : new MeshStandardMaterial({ map: back, roughness: 0.5 })), [back, quality]);
  const edge = useMemo(() => new MeshStandardMaterial({ color: '#efe9dc', roughness: 0.75 }), []);
  useFrame(({ clock }) => {
    const now = clock.getElapsedTime();
    if (t0.current === null) {
      t0.current = now;
      sound.play('shuffle', { dur: tl.shuffle }); // starts exactly with the riffle
    }
    const e = now - t0.current;
    const end = tl.shuffle + tl.dealSpan;
    if (e > end + 0.1) { if (group.current) group.current.visible = false; return; }
    invalidate();
    const u = Math.min(1, e / tl.shuffle); // 0..1 shuffle progress
    const split = u < 0.25 ? u / 0.25 : u < 0.85 ? 1 : 1 - (u - 0.85) / 0.15; // halves apart → riffle → square up
    const dealt = e <= tl.shuffle ? 0 : Math.min(1, (e - tl.shuffle) / Math.max(0.001, tl.dealSpan));
    const left = Math.round(N * (1 - dealt));
    cards.current.forEach((m, j) => {
      if (!m) return;
      const half = j % 2 === 0 ? -1 : 1;
      // riffle: card j drops from its half into the centre stack at its own moment
      const dropAt = 0.25 + 0.6 * (j / N);
      const inCentre = u >= dropAt + 0.06 ? 1 : u <= dropAt ? 0 : (u - dropAt) / 0.06;
      const off = half * 0.16 * split * (1 - inCentre);
      const bend = half * 0.35 * split * (1 - inCentre);
      m.position.set(off, 0, -(j * 0.0042 + (1 - inCentre) * 0.02 * split)); // local -z is 'up' for a face-down card
      m.rotation.set(0, 0, 0);
      m.rotation.y = bend * 0.25;
      m.visible = j < left;
    });
  });
  return (
    <group ref={group} position={at.p} quaternion={new Quaternion(...at.q)} scale={at.s}>
      {Array.from({ length: N }, (_, j) => (
        <group key={j} ref={(el) => { cards.current[j] = el as unknown as Mesh; }}>
          <mesh geometry={geo.body} material={edge} castShadow={quality === 'high'} />
          <mesh geometry={geo.front} material={mat} />
          <mesh geometry={geo.back} material={mat} />
        </group>
      ))}
    </group>
  );
}

/** "Snap this screen" (feedback): render one frame right now and hand back the WebGL canvas while it still holds it. */
function SnapHook() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    const w = window as unknown as { __bwmSnap?: () => string };
    w.__bwmSnap = () => { gl.render(scene, camera); return gl.domElement.toDataURL('image/png'); };
    return () => { delete w.__bwmSnap; };
  }, [gl, scene, camera]);
  return null;
}

/** Test probe: the last hand spread/raise tween length in seconds (0 under reduced motion). */
function handSpreadProbe(s: number): number { if (typeof window !== 'undefined') (window as unknown as { __bwmSpreadS?: number }).__bwmSpreadS = s; return s; }
