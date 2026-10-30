import { RUN_SLAM_MS } from '../runIt';
import { Html } from '@react-three/drei';
import { Canvas, events as r3fEvents, useFrame, useThree } from '@react-three/fiber';
import { type ReactNode, type RefObject, Fragment, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { type BufferGeometry, type Camera, type Group, type Material, type Mesh, type Object3D, ACESFilmicToneMapping, AdditiveBlending, CanvasTexture, DataTexture, Matrix4, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, PCFSoftShadowMap, Quaternion, RepeatWrapping, Scene as ThreeScene, SRGBColorSpace, Texture, Vector2, Vector3 } from 'three';
import { type Card, type Play, type Trick, botPaceDelayMs, isJoker, isNukeTrick } from '@spades/rules';
import Card3D, { createLitCardMaterial } from './Card3D';
import DeuceFxLayer from './DeuceFxLayer';
import { setDeuceCutPose } from './deuceImpact';
import type { DeuceFxInfo } from '../deuceFx';
import KingGun from './KingGun';
import KingRail from './KingRail';
import type { CrowdCue } from './kingRailLayout';
import { departureSlot, handCardKey, handReactKey } from '../handOrder';
import { GAP_S, spreadSeconds, cardIdFromHit, echoTap, fanGapPx, fanMotion, handCardChrome, handDepthOpts, handRenderOrder, hitsInPaintOrder, noteTapUp, pointerNdc, posePx, raiseLocalY, raiseSpreadPx, spreadFitScale } from './handLift';
import { type HandHitCard, pickHandCard, publishHandHits, publishedHandHits } from './handHit';
import { ViewGestureTracker, applyViewAdjustToSpec, beginViewAdjustGesture, endViewAdjustGesture, getViewAdjustState, isDefaultViewAdjust, resetViewAdjust, subscribeViewAdjust, updateViewAdjustLive, zoomForWheelDelta, type ViewAdjust } from '../viewAdjust';
import { paintFace } from '../cardArt';
import { dragStarted, dropResult } from '../dragPlay';
import { DEFAULT_SLAM, type DragSample, clearDrop, dragSlamIntensity, noteDrop, releaseVector, releaseVelocity, slamFeel, slamIntensity, takeDrop } from '../slam';
import { reducedMotion } from './handLift';
import { fanRestSeconds, fanRestTarget, restCharacter, NEUTRAL_REST_CHARACTER, type FanRestPose, type RestCharacter } from './fanRest';
import { flickFlightFor, pickFlightVariant, type FlightVariant, type FlightVariantId } from './flightPose';
import { VISIBLE_FELT, landTrick, playSeed, runScatter } from './landing';
import { shakeOffset, swayOffset } from './shake';
import { captureFlipFrame, flipHeld, flipRehearsed, flipUserFlipped, markRehearsed, noteFlipSizeCommit, notePresentedFrame, noteRehearsalSize, registerCover, releaseFlipHold, setFlipHoldLock, subscribeFlipHold } from './flipHold';
import { isShortLandscape } from '../viewport';
import { type DealTimeline, dealTimeline, seatDealDelay } from './dealTimeline';
import { dealHeld, handDealsIn, handOnFan, handSlotKey } from './dealFlight';
import { cardShowsFace, flatFanHidden, handLatched, latchHand, resumeDrawList, showResumeHand3D, visibleFaceIds } from './cardFace';
import { openingTrickKeys, trickCardLaunches, trickPlayFrom } from './trickFacing';
import { lastRestFrameSec, playRestFrameSec, presentationCaughtUp, reviewDelaySec, serializedPlayDelaySec, spacedPlayDelaySec, sweepEndFrameSec, SEQUENCE_FRAME_SLACK_SEC } from './sweepGate';
import { type Sfx, sound } from '../audio';
import { fx } from '../fx';
import { backTexture, faceTexture, logoTexture, peekFaceTexture, refreshFacesGradually } from './cardTextures';
import { loadTableImage, prefetchTableTextures, tableTextureUrls } from '../tableAssets';
import { ClassicHall } from './hallEnv';
import { forceProgram, nextFrame, quietShaderErrors } from './shaderBudget';
import { noteCrumb, reportCrash, setCrashContext } from '../telemetry';
import { importChunk } from '../chunkLoad';
import { offerTableRenderer } from '../effects/warm';
import Venue3D, { feltPatternTexture, preloadVenueAssets } from './Venue3D';
import ClassicStudio, { preloadClassicStudio } from './ClassicStudio';
import BarbershopRoom, { preloadBarbershopRoom } from './BarbershopRoom';
import BarbershopMirrorRoom from './BarbershopMirrorRoom';
import RooftopRoom, { preloadRooftopRoom } from './RooftopRoom';
import YachtRoom, { preloadYachtRoom } from './YachtRoom';
import YachtDeckRoom from './YachtDeckRoom';
import BeachRoom, { preloadBeachRoom } from './BeachRoom';
import BeachCabanaRoom from './BeachCabanaRoom';
import BackyardRoom, { preloadBackyardRoom } from './BackyardRoom';
import ChurchRoom, { preloadChurchRoom } from './ChurchRoom';
import ChurchBasementRoom from './ChurchBasementRoom';
import RecCenterGymRoom from './RecCenterGymRoom';
import RooftopDuskRoom from './RooftopDuskRoom';
import RooftopSkylineRoom from './RooftopSkylineRoom';
import HighRisePenthouseRoom from './HighRisePenthouseRoom';
import LegendsTableRoom from './LegendsTableRoom';
import VegasCasinoRoom from './VegasCasinoRoom';
import VegasRoom, { preloadVegasRoom } from './VegasRoom';
import SpeakeasyRoom, { preloadSpeakeasyRoom } from './SpeakeasyRoom';
import CornerStreetRoom from './CornerStreetRoom';
import SpeakeasyLoungeRoom from './SpeakeasyLoungeRoom';
import PorchDeckRoom from './PorchDeckRoom';
import PorchFigures from './PorchFigures';
import PersonaFigures from './PersonaFigures';
import SeatVideoLayer from './SeatVideo';
import { FIGURE_SEAT_CONFIGS } from './figureSeats';
import GrandmasKitchenRoom from './GrandmasKitchenRoom';
import CookoutYardRoom from './CookoutYardRoom';
import GrandmaRoom, { preloadGrandmaRoom } from './GrandmaRoom';
import MansionRoom, { preloadMansionRoom } from './MansionRoom';
import { type VenueDef, type VenueId, VENUE_DEFS, venueAssetUrls } from '../venues';
import { bodyGeometry, cardGeometry, feltGeometry, railGeometry } from './geometry';
import {
  CH, CW, MIN_STRIP_PX, TRICK_SCALE, type CamSpec, type FanOpts, type SeatPos, type Xform, badgeSpot, cameraFor, cameraPoseAt, CAMERA_VIEW_TWEEN_MS, cardScreenQuad, deckSpot, fanCssPx, fanLayout, handCardPlane, handFan, kingGunSpot, makeCamera, jitterOf, opponentFan, phoneHandFan, PHONE_HAND_STRIP_PX, pileSpot, ringSpot, trickSpot,
  flatRest,
  xf,
} from './layout';
import { plateCy0, solvePlates, type PlateRect, type PlateSolveInput, type SidePlateGeom, type TopPlateGeom } from './plateLayout';

export interface SceneProps {
  quality: 'high' | 'low';
  /** the 3D table has rendered its first frame (the placeholder fades out). Textures and the hall light stream in after this. */
  onTableReady?: () => void;
  /** The canvas has presented a frame and the frame loop is past it (the second frame on the loop): the first frame's shader compiles are behind it. */
  onFirstFrame?: () => void;
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
  /** Identity of the turn-relevant state Table derived `legal` from
   *  (turnPresentation.ts). The highlight waits for the presentation: Scene
   *  calls onTurnPresented with this key once every play on the table has
   *  rested and any pending collection has finished, on the frame clock. */
  turnKey?: string;
  /** Presentation certification for turnKey (see above). Fired once per key. */
  onTurnPresented?: (key: string) => void;
  selected: Card | null;
  turnSeat: number | null;
  /** The seat to act right now (bidding, playing or exchange), in table seat
   *  order — Table's `actor` (turnView/actingSeat), for EVERY seat. Distinct
   *  from turnSeat above, which Table passes human-only for the turn ring.
   *  Drives the fan rest pose (fanRest.ts): every other seat's fan rests. */
  activeSeat?: number | null;
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
  /** Deuce Drop / Cut classification for a played card (deuceFx.ts), from the same
   *  state the landCue reads. Absent (watch / broadcast surfaces) = no deuce impacts. */
  deuceFx?: (card: Card) => DeuceFxInfo | null;
  /** Phone landscape layout (see viewport.ts): own camera, smaller trick, hand between the HUD corners. */
  short?: boolean;
  /** Safe-area insets in CSS px. */
  safe?: { l: number; r: number; t: number; b: number };
  /** Tips mode. The turn lift is the same 14px either way; tip marks still use `marked`. */
  hintLegal?: boolean;
  /** cards an open tip points at: they glow (on the table and in your hand) */
  marked?: Card[];
  /** ☢ the final trick is armed (both Jokers down, trick not done): the trick cards pulse "ready to blow" until the last card lands and it detonates. */
  trickArmed?: boolean;
  /** Reduce effects: the venue stays calm and the nuke plays its calm version. */
  reduceFx?: boolean;
  /** 'Run it!': the claimer's remaining cards slam down face up in a row at the table centre ALL AT ONCE, then
   *  everyone else's remaining cards hit the table together in a quick cascade (then the tornado takes everything) */
  slam?: { seat: number; cards: Card[]; others?: { seat: number; card: Card }[] } | null;
  /** the venue (3D arena) around the table; default classic */
  venue?: VenueId;
  /** Post-hand: books slide to the next dealer for collection (Demetrius 2026-10-19). */
  collecting?: boolean;
  /** The finished-trick hold (finishedTrickHoldMs, plain path — no Run It, no
   *  nuke) for the trick that most recently finished, in ms. Scene anchors it
   *  to the last card's rest on the shared frame clock (sweepGate.ts): the
   *  completed trick sits reviewable for this long AFTER its last card lands,
   *  and the next trick's first flight waits for the sweep that follows.
   *  Absent (watch/broadcast surfaces) = no anchoring, today's behaviour. */
  reviewHoldMs?: number;
  /** Bot flight pacing (owner, 2026-10-30): the scheduling layer's pacing
   * identity for bot seats — its base wait (solo BOT_PLAY_MS, online the
   * server's botMs), the speed multiplier that base runs at on this table
   * (the table's k offline, 1 online), and which seats are bots. Scene
   * re-asserts each bot play's seeded draw (rules/pacing.ts — the same
   * draw the scheduler waited) as a minimum spacing after the previous
   * play's flight start, so a sweep floor that shifts one flight can no
   * longer compress the next bot's card against it. Absent (watch /
   * broadcast surfaces) = no spacing term, today's behaviour. */
  botPace?: { baseMs: number; speedK: number; botSeats: readonly number[] };
  /** Misdeal redeal, beat 1: every hand on the table glides to the deck spot (the collection
   *  glide) while the call is announced, before the redeal deals out. The deck spot sits in
   *  front of the CURRENT dealer — and a misdeal passes the deal, so on the redealt state this
   *  is the incoming dealer's spot: the pile travels to them. */
  gatherHands?: boolean;
  /** Misdeal redeal, beat 2: bumped when the redeal should deal out — remounts the card layer
   *  so this hand's normal shuffle + deal flight replays under the same hand number. */
  dealEpoch?: number;
  /** Misdeal redeal, beat 2 is running: the redeal's deal flight deals the hand out of the
   *  deck on the normal per-card timeline. This matters on a hand the intro machinery treats
   *  as already placed (a resumed hand has no intro): the flight still gates every fan —
   *  a player holds no cards until the flight deals them, never from the state swap. */
  dealFlight?: boolean;
  /** The King's double or nothing, leg 2: the seat beside which his revolver
   *  lies on the felt for the whole match (set down in the between-legs beat;
   *  Table keys it to the live double-pending state, so a resume into the
   *  decider shows it too). Null/absent = no gun, ever. */
  kingGunSeat?: number | null;
  /** The King's rail cast (character ids) standing around the table as
   *  3D figures — King story tables only; empty/absent everywhere else. */
  kingRailCast?: readonly string[];
  /** The story stop this table is playing (story tables only). Story-
   *  scoped room dressing keys off it: at stop `corner` (venueId
   *  speakeasy) the High-quality room is the Corner street
   *  environment, not the Speakeasy Lounge — see CornerStreetRoom;
   *  at stop `porch` (venueId grandma) it is the Porch deck, not
   *  Grandma's Kitchen — see PorchDeckRoom; at stop `barbershop`
   *  it is the mirror-walled shop, not the venue room — see
   *  BarbershopMirrorRoom; at stop `church-basement` (venueId
   *  church) it is the fellowship basement, not the cube room —
   *  see ChurchBasementRoom. The story branch keeps priority at
   *  the speakeasy and grandma venues: their NON-story High
   *  tables mount the venues' own bespoke rooms instead (the
   *  Speakeasy Lounge, Grandma's Kitchen — Batch C1), while
   *  Low keeps the cube rooms.
   *  Null/absent = not a story table; every venue renders as itself. */
  storyStopId?: string | null;
  /** Per-seat seated figures (character id or null, by seat): at the
   *  King table the seated story characters render in the scene. */
  seatedFigures?: readonly (string | null)[];
  /** Per-seat rigged 3D figures (character id or null, by seat) for the
   *  story tables (the Porch pilot, character phase step 2, rolled out
   *  route-wide 2026-10-29): Table sets this ONLY for story tables —
   *  solo seats Dee + the stop's pair, co-op seats the pair only (the
   *  partner seat is a human) — and never for the King stop, whose
   *  seated figures ride KingRail above. The scene seats the real cast
   *  at High quality (three/PorchFigures.tsx) and raises the Sitting
   *  camera to the people framing while figures are active. Absent
   *  everywhere else — Low and non-story tables never see a figure. */
  figureSeats?: readonly (string | null)[];
  /** Per-seat persona figure keys (or null, by seat) for REGULAR
   *  (non-story) tables: Table sets this for bot seats whose persona
   *  has a shipped rigged figure (three/PersonaFigures.tsx). The
   *  figures lazy-mount over the portrait treatment at High quality;
   *  they are not part of the loader's asset gate. Absent at story
   *  tables, where the cast system owns the seats. */
  personaFigureSeats?: readonly (string | null)[];
  /** Per-seat live camera feeds (MediaStream or null, by local seat):
   *  a remote seated human's video renders on a plane at their chair
   *  (three/SeatVideo.tsx; owner directive 2026-10-30). Built only by
   *  the online table for seated (non-spectator) clients; absent
   *  everywhere else — solo, lobby, watch/broadcast surfaces. The
   *  human's own seat is always null here (first person). */
  seatVideos?: readonly (MediaStream | null)[];
  /** The crowd cue channel (stirs + speakers), stamped by the table. */
  crowdCue?: CrowdCue;
  /** False under reduced effects: figures render at rest, static. */
  crowdAnimate?: boolean;
  /** The filmed-visit system is live at this table (solo King sample):
   *  a character with visit clips leaves the standing ring and only visits. */
  visitRail?: boolean;
  /** camera view: standing (default) or sitting (lower/closer) */
  view?: 'standing' | 'sitting';
  /** Turn up (slam mode): Standing drags slam at max only when this is on. */
  turnUp?: boolean;
}

/** The people framing (immersive sandbox Phase C, owner pick
 *  2026-10-27): while the Porch pilot's figures are seated, the SITTING
 *  camera raises +0.37 and its aim lifts +0.48 / −0.38 so the partner's
 *  face and body clear the plate line. Applied at the Porch story seam
 *  ONLY — this is the ratification candidate: the owner's device
 *  verdict on the pilot settles whether it becomes the default 3D
 *  gameplay camera. Standing is never offset. The hand fan solver
 *  works against the STOCK camera, so Cards refits the human hand by
 *  the matching matrix (see `peopleCam` in Cards) — the two halves of
 *  the framing move together or the fan sinks out of frame. */
export const PEOPLE_CAM = { raise: 0.37, lookDy: 0.48, lookDz: -0.38 } as const;

/** View matrix (world -> camera) for a cameraFor-style spec, the
 *  sandbox's camMatrix: lookAt rotation with the position set after. */
export function camMatrixOf(pos: readonly number[], look: readonly number[]): Matrix4 {
  const m = new Matrix4().lookAt(new Vector3(pos[0]!, pos[1]!, pos[2]!), new Vector3(look[0]!, look[1]!, look[2]!), new Vector3(0, 1, 0));
  m.setPosition(pos[0]!, pos[1]!, pos[2]!);
  return m;
}

/** The people-framing Sitting spec for a stock Sitting spec. */
export function peopleSpec(spec: CamSpec): CamSpec {
  return {
    fov: spec.fov,
    pos: [spec.pos[0], spec.pos[1] + PEOPLE_CAM.raise, spec.pos[2]],
    look: [spec.look[0], spec.look[1] + PEOPLE_CAM.lookDy, spec.look[2] + PEOPLE_CAM.lookDz],
  };
}

function CameraRig({ view = 'standing', people = false }: { view?: 'standing' | 'sitting'; people?: boolean }) {
  const { camera, size, invalidate } = useThree();
  const short = isShortLandscape(size.width, size.height);
  const anim = useRef<{ from: number[]; to: number[]; fromLook: number[]; toLook: number[]; start: number; dur: number } | null>(null);
  const booted = useRef(false);
  const lookAtRef = useRef<number[] | null>(null);
  // Adjustable view (owner, 2026-10-29): the rig works in BASE space (the
  // cameraFor spec, plus the people framing where it applies) and every
  // placement renders applyViewAdjustToSpec(base, savedOffset) on top — so
  // the offset survives rotation, posture tweens and new hands untouched,
  // and at the default offset the rendered camera is the stock one exactly.
  const vaState = useSyncExternalStore(subscribeViewAdjust, getViewAdjustState);
  const adjRef = useRef(vaState.adj);
  adjRef.current = vaState.adj;
  const baseRef = useRef<{ pos: number[]; look: number[] } | null>(null);
  const placeRef = useRef<(pos: readonly number[], look: readonly number[], t: number) => void>(() => undefined);
  placeRef.current = (pos, look, t) => {
    const cam = camera as import('three').PerspectiveCamera;
    const s = applyViewAdjustToSpec({ pos, look, fov: cam.fov }, adjRef.current);
    cam.position.set(s.pos[0]!, s.pos[1]!, s.pos[2]!);
    cam.lookAt(new Vector3(s.look[0]!, s.look[1]!, s.look[2]!));
    sound.setSpatialListener(s.pos, s.look); // the listener follows the ACTUAL camera
    (window as unknown as { __bwmCam?: unknown }).__bwmCam = { view, people, y: cam.position.y, z: cam.position.z, x: cam.position.x, t, tweenMs: CAMERA_VIEW_TWEEN_MS, tilt: adjRef.current.tilt, zoom: adjRef.current.zoom };
  };
  useLayoutEffect(() => {
    const a = size.width >= 32 && size.height >= 32 ? size.width / size.height : 9 / 16;
    const stockSpec = cameraFor(a, short, view);
    const spec = people && view === 'sitting' ? peopleSpec(stockSpec) : stockSpec;
    const cam = camera as import('three').PerspectiveCamera;
    if (!Number.isFinite(spec.fov)) return;
    cam.fov = spec.fov;
    cam.aspect = a;
    cam.updateProjectionMatrix();
    if (!booted.current) { // first frame: land exactly on the saved view (offset included), no flight
      booted.current = true;
      baseRef.current = { pos: [...spec.pos], look: [...spec.look] };
      lookAtRef.current = [...spec.look];
      placeRef.current(spec.pos, spec.look, 1);
      invalidate(); return;
    }
    // Respect ONLY the real OS setting; the app's Reduce-effects pref must not kill the move.
    const reduced = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const fromPos = baseRef.current?.pos ?? [cam.position.x, cam.position.y, cam.position.z];
    const fromLook = lookAtRef.current ?? (() => { const d = new Vector3(); cam.getWorldDirection(d); return [cam.position.x + d.x, cam.position.y + d.y, cam.position.z + d.z]; })();
    anim.current = { from: [...fromPos], to: [...spec.pos], fromLook: [...fromLook], toLook: [...spec.look], start: performance.now(), dur: reduced ? 0 : CAMERA_VIEW_TWEEN_MS };
    (window as unknown as { __bwmCam?: unknown }).__bwmCam = { view, people, y: cam.position.y, z: cam.position.z, x: cam.position.x, t: 0, tweenMs: CAMERA_VIEW_TWEEN_MS, tilt: adjRef.current.tilt, zoom: adjRef.current.zoom };
    invalidate();
  }, [camera, size, short, view, people, invalidate]);
  // Offset changed (a drag, a reset, a seed): re-place instantly on the
  // current base pose. A running view tween reads the store live instead.
  useEffect(() => {
    if (anim.current || !baseRef.current) return;
    placeRef.current(baseRef.current.pos, baseRef.current.look, 1);
    invalidate();
  }, [vaState.adj, invalidate]);
  useFrame(() => {
    const a = anim.current; if (!a) return;
    // Wall clock, never raw frame dt (see cameraPoseAt): an idle demand-loop's first dt is huge.
    const pose = cameraPoseAt(a.from, a.to, a.fromLook, a.toLook, performance.now() - a.start, a.dur);
    baseRef.current = { pos: pose.pos, look: pose.look };
    lookAtRef.current = pose.look;
    sound.setSpatialListener(pose.pos, pose.look);
    // place() then re-asserts the listener at the RENDERED pose — the base
    // pose with the player's tilt/zoom composed on top (the same pose at
    // the default offset).
    placeRef.current(pose.pos, pose.look, pose.t);
    if (pose.t >= 1) anim.current = null;
    invalidate();
  });
  return null;
}

/**
 * Adjustable-view gestures (owner, 2026-10-29): drag on the open table to
 * tilt, pinch to zoom, wheel on desktop, double-tap to reset. The listeners
 * sit on the canvas WRAP in the bubble phase and only accept presses whose
 * target is the canvas itself — every DOM overlay (bid panel, buttons,
 * chat, menus, the felt hand) is a different target and keeps its gestures.
 * Presses that begin on a fan card never even arrive: HandPointer consumes
 * them in the capture phase (and the pickHandCard check below repeats the
 * exclusion here for the paths where it is not mounted). The tracker
 * (viewAdjust.ts) owns the state machine; this component is only plumbing.
 */
function ViewAdjustControls() {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const el = gl.domElement;
    const wrap = el.parentElement;
    if (!wrap) return;
    let raf = 0;
    let pending: ViewAdjust | null = null;
    const flush = () => { raf = 0; if (pending) { updateViewAdjustLive(pending); pending = null; } };
    const queueLive = (adj: ViewAdjust) => { pending = adj; if (!raf) raf = requestAnimationFrame(flush); };
    const settle = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } pending = null; };
    const tracker = new ViewGestureTracker({
      onBegin: () => beginViewAdjustGesture(),
      onLive: (adj) => queueLive(adj),
      onEnd: (adj) => { settle(); endViewAdjustGesture(adj); },
      onReset: () => { settle(); resetViewAdjust(); },
    });
    let wheelAdj: ViewAdjust | null = null;
    let wheelTimer: ReturnType<typeof setTimeout> | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.target !== el) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const rect = el.getBoundingClientRect();
      const onTable = pickHandCard(e.clientX - rect.left, e.clientY - rect.top) === null;
      tracker.down(e.pointerId, e.clientX, e.clientY, onTable, getViewAdjustState().adj, performance.now());
    };
    const onMove = (e: PointerEvent) => tracker.move(e.pointerId, e.clientX, e.clientY);
    const onUp = (e: PointerEvent) => tracker.up(e.pointerId, e.clientX, e.clientY, performance.now());
    const onCancel = (e: PointerEvent) => tracker.cancelPointer(e.pointerId);
    const onWheel = (e: WheelEvent) => {
      if (e.target !== el || tracker.active) return;
      e.preventDefault();
      if (!wheelAdj) beginViewAdjustGesture();
      const base = wheelAdj ?? getViewAdjustState().adj;
      wheelAdj = { tilt: base.tilt, zoom: zoomForWheelDelta(base.zoom, e.deltaY) };
      queueLive(wheelAdj);
      if (wheelTimer) clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => { wheelTimer = null; const a = wheelAdj; wheelAdj = null; if (a) { settle(); endViewAdjustGesture(a); } }, 350);
    };
    const onInterrupt = () => tracker.cancelAll();
    wrap.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    wrap.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', onInterrupt);
    window.addEventListener('blur', onInterrupt);
    return () => {
      wrap.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      wrap.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onInterrupt);
      window.removeEventListener('blur', onInterrupt);
      if (wheelTimer) clearTimeout(wheelTimer);
      settle();
      tracker.cancelAll();
    };
  }, [gl]);
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
export function preloadTableAssets(quality: 'high' | 'low', venue: VenueId = 'classic', storyStopId: string | null = null): void {
  const rail = venueAssetUrls(venue, quality).rail;
  prefetchTableTextures(quality, rail ? [rail] : []);
  // The classic hall HDRI is ~400 KB and its PMREM filter used to freeze the page after the felt appeared.
  // It starts only once the cloth is up (see ClassicHall). Other venues still warm their own files here.
  // The King's Lounge (blockAfterDark + king + High) dresses from the Classic
  // Studio set, so a king table notes/warms those files for its gate too.
  if (venue === 'blockAfterDark' && storyStopId === 'king' && quality === 'high') preloadClassicStudio(quality);
  if (venue === 'barbershop') preloadBarbershopRoom(quality);
  else if (venue === 'rooftop') preloadRooftopRoom(quality);
  else if (venue === 'yacht') preloadYachtRoom(quality);
  else if (venue === 'beach') preloadBeachRoom(quality);
  else if (venue === 'backyard') preloadBackyardRoom(quality);
  else if (venue === 'church') preloadChurchRoom(quality);
  else if (venue === 'vegas') preloadVegasRoom(quality);
  else if (venue === 'speakeasy') preloadSpeakeasyRoom(quality);
  else if (venue === 'grandma') preloadGrandmaRoom(quality);
  else if (venue === 'mansion') preloadMansionRoom(quality);
  else if (venue !== 'classic') preloadVenueAssets(venue, quality);
  else preloadClassicStudio(quality);
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
  // The crystal table's BODY stays solid. A transparent apron let the venue floor bleed
  // through the near wall (worst at the mansion, whose marble floor is bright), so the table
  // read hollow around the player's seat (owner, 2026-10-25). The rail ring above keeps the
  // crystal translucency; the body reads as frosted glass — same gloss, no see-through.
  const apron = def.rail === 'crystal'
    ? new MeshPhysicalMaterial({ color: def.apron, roughness: 0.05, clearcoat: 1 })
    : def.rail === 'chrome' || def.rail === 'metal'
      ? new MeshStandardMaterial({ color: def.apron, metalness: 0.7, roughness: 0.3 })
      : new MeshStandardMaterial({ map: white, roughness: 0.6, color: def.apron });
  const floor = new MeshStandardMaterial({ color: '#120b18', roughness: 0.95 });
  return { felt, wood, apron, floor };
}

function TableModel({ quality, lit, onReady, onTextured, def, roomFloor }: { quality: 'high' | 'low'; lit: boolean; onReady?: () => void; onTextured?: () => void; def: VenueDef; /** A story seam room provides this table's floor — suppress the classic ground plane (it sits at the same FLOOR_Y and z-fights the room's own floor; owner device report 2026-10-28: Rec Center floor rendering as dark streaks). */ roomFloor?: boolean }) {
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
      {def.id === 'classic' && !roomFloor && (
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
  // A deal flight is running for this hand: the intro deal, or a misdeal redeal dealing out.
  // The redeal replays under the same hand number, and on a resumed hand the intro flag is
  // off — but its cards still leave the deck on the deal timeline like any fresh deal.
  const flight = intro || !!props.dealFlight;
  // Misdeal gather: while the call is announced, every hand rides the collection glide into the
  // deck spot — which belongs to the incoming dealer, the deal having passed on the call — and
  // the redeal's shuffle + deal flight then run out of that same deck (see Table's sequence).
  const gather = !!props.gatherHands;
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
  // Trick sequencing on the same capped-dt frame clock the cards fly on
  // (sweepGate.ts, review anchoring): seqClock accumulates every frame;
  // playRests stamps each play's predicted rest (item key -> frame second)
  // when its item is first built; pileSeq remembers which pile was last
  // seen complete and the frame second its collection finishes, so the
  // next trick's flights can be serialized behind that sweep.
  const seqClock = useRef(0);
  const playRests = useRef<{ hand: number; rests: Map<string, number> }>({ hand: -1, rests: new Map() });
  // Bot pacing: each launched play's flight START on the same frame clock
  // (item key -> frame second), so the next bot play can be spaced from the
  // previous flight's actual start even when a sweep floor shifted it.
  const playStarts = useRef<{ hand: number; starts: Map<string, number> }>({ hand: -1, starts: new Map() });
  const pileSeq = useRef<{ hand: number; seenPileId: string; sweepUntil: number; anchorPileId: string; anchorStart: number }>({ hand: -1, seenPileId: '', sweepUntil: 0, anchorPileId: '', anchorStart: 0 });
  // Turn presentation certification (turnPresentation.ts): the last turnKey
  // this scene has certified as fully presented — every play rested, no
  // collection running — on the frame clock. Table holds the playable
  // highlight back until the key it derived `legal` from is certified, so
  // the highlight arrives with the table instead of with the state.
  const certifiedTurn = useRef<string | null>(null);
  const onDealDone = props.onDealDone;
  const dealArmed = intro && !held0;
  useFrame((_, rawDt) => {
    seqClock.current += Math.min(Math.max(rawDt, 0), 0.05);
    const tk = props.turnKey;
    if (tk && props.onTurnPresented && certifiedTurn.current !== tk) {
      const rests = shownTrick.map((pl) => playRests.current.rests.get(`${handNo}-${pl.card}`));
      if (presentationCaughtUp({ rests, sweepUntilFrameSec: pileSeq.current.sweepUntil, nowFrameSec: seqClock.current })) {
        certifiedTurn.current = tk;
        props.onTurnPresented(tk);
      } else invalidate();
    }
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
  // Porch pilot people framing: while the pilot is active CameraRig
  // renders the raised Sitting camera, but the hand solver lays the
  // fan out against the STOCK camera — left alone, the fan would sink
  // out of the raised frame. Refit the human hand's slot targets by
  // M = V · S^-1 (the sandbox's refit): a refit point projects under
  // the live (people) camera to exactly the screen position the stock
  // solver chose, so the fan keeps its solved screen layout while the
  // world behind it rises. ONLY the human hand's fan slots (and the
  // flip-in-place poses derived from them) are refit: the deal flight
  // still leaves the real deck, the gather override still targets the
  // deck, and the published hit quads are computed from the STOCK
  // targets (cardScreenQuad re-derives the same screen points the
  // refit preserves). Departure slots inherit the refit because
  // nextSlots stores the refit targets.
  const peopleCam = view === 'sitting' && quality === 'high'
    && !!(props.figureSeats?.some(Boolean)) && !!(props.storyStopId && FIGURE_SEAT_CONFIGS[props.storyStopId]);
  // Adjustable view (owner, 2026-10-29): CameraRig renders the base spec
  // (stock, or the people spec at the pilot) with the player's tilt/zoom on
  // top; the fan refit generalizes the people refit to that rendered spec,
  // so the hand keeps its solved screen layout at ANY tilt/zoom — the hit
  // quads stay the stock ones, exactly as with the people framing. At the
  // default offset with no pilot this is byte-identical to before (no refit).
  const vaState = useSyncExternalStore(subscribeViewAdjust, getViewAdjustState);
  const refitM = useMemo(() => {
    if (!peopleCam && isDefaultViewAdjust(vaState.adj)) return null;
    const stock = cameraFor(aspect, short, view);
    const people = peopleSpec(stock);
    // The people refit, exactly as shipped: M = V * S^-1 against the stock
    // spec (peopleCam only ever occurs at the sitting view, so `view` is
    // 'sitting' whenever this matrix exists) — the fan rides the people
    // framing or it sinks out of frame.
    const peopleM = peopleCam
      ? camMatrixOf(people.pos, people.look).multiply(camMatrixOf(stock.pos, stock.look).invert())
      : null;
    if (isDefaultViewAdjust(vaState.adj)) return peopleM;
    // The player's tilt/zoom composes ON TOP of the base framing (the stock
    // spec, or the people spec at the pilot): its own M = A * B^-1,
    // multiplied onto peopleM where there is one. The product is
    // M(actual) * S^-1 either way, so the fan keeps its solved screen
    // layout at any offset.
    const base = peopleCam ? people : stock;
    const actual = applyViewAdjustToSpec(base, vaState.adj);
    const adjM = camMatrixOf(actual.pos, actual.look).multiply(camMatrixOf(base.pos, base.look).invert());
    return peopleM ? adjM.multiply(peopleM) : adjM;
  }, [peopleCam, aspect, short, view, vaState.adj]);
  const refitXf = (x: Xform): Xform => {
    if (!refitM) return x;
    const m = new Matrix4().compose(new Vector3(x.p[0], x.p[1], x.p[2]), new Quaternion(x.q[0], x.q[1], x.q[2], x.q[3]), new Vector3(x.s, x.s, x.s));
    m.premultiply(refitM);
    const p = new Vector3(); const q = new Quaternion(); const s = new Vector3();
    m.decompose(p, q, s);
    return { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w], s: s.x };
  };
  // Sitting: lift the whole fan above the iPhone home indicator + Safari bottom chrome (safe-area
  // bottom + a 12px breathing margin), in the LIVE view's camera. Standing keeps its exact framing.
  const sittingBottom = view === 'sitting' ? (safe.b + 12) / Math.max(1, screenH) : 0;
  const fanOpts: FanOpts = short
    ? { short, view, reserveFrac: (Math.max(safe.l, safe.r) + 186) / size.width, bottomFrac: safe.b / Math.max(1, size.height) + sittingBottom, heightFrac: 0.32, ...strip } // bigger hand in landscape (was 0.25)
    : wide ? { view, reserveFrac: (size.width < 1400 ? 250 : 205) / size.width, bottomFrac: 0.012, heightFrac: 0.256, ...strip } // +25% hand (was 0.205)
    : portraitPhone ? { ...phoneHandFan(), view, bottomFrac: (phoneHandFan().bottomFrac ?? 0) + sittingBottom, ...strip, minStripPx: (handCounts[human] ?? 13) > 13 ? MIN_STRIP_PX : PHONE_HAND_STRIP_PX }
    : { view, ...strip };
  const trickScale = short ? 1.81 : undefined; // +25% over the old 1.45, same ratio as TRICK_SCALE
  // Fan rest (owner 2026-10-28, fanRest.ts): every seat's fan rests while it
  // is NOT the seat to act, and opens to the normal spread for the acting
  // seat. The pose is two channels — DROP (lower) and PINCH (tighten):
  // Sitting rests at any aspect but pinches only in landscape (portrait
  // sitting lowers at its open width); Standing rests with both channels
  // in landscape only. Keyed to props.activeSeat — the same
  // acting-seat signal the plates/badges use — so the human's fan starts rising
  // the moment the turn arrives (and it is NOT exempt: off-turn it rests too).
  // Poses are fed to Card3D as ordinary pose targets and its tween eases them;
  // `moving` marks the transition window, during which the human fan (whose 'lift'
  // path snaps straight to its target) rides the 'slide' tween instead, and an
  // opponent fan takes the rest duration instead of the deal-fly duration.
  // Reduced motion (OS, or the app's Reduce effects) settles instantly.
  const restReduced = reducedMotion() || !!props.reduceFx || fx.osReducedMotion;
  type RestTrack = { target: FanRestPose; until: number; legs: number; char: RestCharacter; overUntil: number };
  const restTrack = useRef<{ hand: number; seats: Map<number, RestTrack> }>({ hand: -1, seats: new Map() });
  if (restTrack.current.hand !== handNo) restTrack.current = { hand: handNo, seats: new Map() };
  const restFor = (seat: number): { drop: number; pinch: number; moving: boolean; durSec: number } => {
    const target = fanRestTarget({ aspect, view, seatIsActive: props.activeSeat != null && props.activeSeat === seat });
    if (restReduced) { restTrack.current.seats.set(seat, { target, until: 0, legs: 0, char: NEUTRAL_REST_CHARACTER, overUntil: 0 }); return { drop: target.drop, pinch: target.pinch, moving: false, durSec: fanRestSeconds(true) }; }
    const track = restTrack.current.seats.get(seat);
    if (!track) { restTrack.current.seats.set(seat, { target, until: 0, legs: 0, char: NEUTRAL_REST_CHARACTER, overUntil: 0 }); return { drop: target.drop, pinch: target.pinch, moving: false, durSec: fanRestSeconds(false) }; }
    const now = performance.now();
    if (track.target.drop !== target.drop || track.target.pinch !== target.pinch) {
      track.target = target;
      track.legs += 1;
      // Rest character (owner, 2026-10-30): every transition lowers or raises
      // with its own duration and settle depth — and on some legs a small
      // overshoot dip past the settle depth before easing back onto it — so
      // the fan never relaxes the same way twice. Seeded per hand + seat +
      // leg, so a fan's sequence is stable within the hand. The target (and
      // therefore WHETHER/WHEN a fan rests) is still fanRestTarget's alone.
      track.char = restCharacter(handNo * 1000 + seat * 100 + track.legs);
      // Card3D caps its frame dt, so on a starved canvas its tween runs behind
      // wall clock: hold the window a beat past the tween's own length.
      track.until = now + track.char.durMs + 350;
      track.overUntil = target.drop > 0 && track.char.overshoot > 0 ? now + track.char.durMs * 0.55 : 0;
    }
    const ch = track.char;
    const over = now < track.overUntil;
    return {
      drop: target.drop * (ch.dropDepth + (over ? ch.overshoot : 0)),
      pinch: target.pinch * ch.pinchDepth,
      moving: now < track.until,
      // The Card3D duration for the current phase: an overshoot leg tweens to
      // the dipped pose over the first 55% of its duration, then back up to
      // the settle pose over the rest (one mid-leg retarget); other legs run
      // their full character duration.
      durSec: (over ? ch.durMs * 0.55 : track.overUntil > 0 ? ch.durMs * 0.45 : ch.durMs) / 1000,
    };
  };
  useEffect(() => {
    const w = window as unknown as { __bwmFanRest?: unknown };
    w.__bwmFanRest = {
      activeSeat: props.activeSeat ?? null, view, aspect, short, reduced: restReduced,
      seats: Array.from({ length: n }, (_, seat) => ({ seat, target: fanRestTarget({ aspect, view, seatIsActive: props.activeSeat != null && props.activeSeat === seat }) })),
    };
  });
  // Last committed hand, so a play can launch from that card's own slot. Updated in an effect (not during render)
  // so a highlight change and the server ack share one set of keys and don't restart the fan.
  type Held = { handNo: number; cards: Set<string>; slots: Map<string, Xform>; count: number; seen: Set<string> };
  const held = useRef<Held>({ handNo: -1, cards: new Set(), slots: new Map(), count: 0, seen: new Set() });
  if (held.current.handNo !== handNo) held.current = { handNo, cards: new Set(), slots: new Map(), count: 0, seen: new Set() };
  const pendingHold = useRef<Held>(held.current);

  type Item = { spatialSeat?: SeatPos; spatialN?: number; slam?: import('../slam').SlamFeel; key: string; card: Card | null; cardId?: string | null; target: Xform; from?: Xform; origin?: Xform; delay?: number; dim?: boolean; glow?: boolean; armed?: boolean; tap?: ((cardId: string) => void) | null; shadow?: boolean; duration?: number; arc?: number; motion?: 'lift' | 'flight' | 'slide' | 'glide' | 'gather' | 'flick'; variant?: FlightVariant; raise?: number; roll?: number; order?: number; sfxStart?: Sfx; sfxLand?: string; hand?: boolean; public?: boolean; holdUntilMove?: boolean; impactFx?: { kind: 'drop' | 'cut'; victim?: Card | null } | null; knock?: { dirX: number; dirZ: number } | null };
  const items: Item[] = [];
  // Seats still in this hand (a Cutthroat ejection leaves a seat with no cards): the deal
  // schedule goes around these only, or late cards are timed past the end of the deal.
  const liveSeatsForDeal = handCounts.flatMap((c, seat) => (c > 0 ? [seat] : []));
  const dealDelay = (slot: number, seat: number) => seatDealDelay(tl, n, slot, seat, dealer, liveSeatsForDeal);

  // completed tricks in piles
  const pileCount = Array(n).fill(0) as number[];
  // Post-hand collection: books slide to the next dealer's deck spot (Demetrius 2026-10-19).
  // Stagger by seat so each player's stack goes in turn, ~4s total.
  const collecting = !!props.collecting;
  const nextDealer = (dealer + 1) % n;
  const collectTarget = deckSpot(positions[nextDealer]!, n);
  // Review anchoring + sweep serialization (sweepGate.ts): when a trick newly
  // flips into the piles, a plain trick's (no Run It, no nuke — those shows
  // own their own clocks) gather is delayed so the sweep starts at the last
  // card's rest + the review hold: the completed trick sits reviewable for
  // the full hold AFTER landing, at every table speed. The fresh pile's
  // sweep end frame is recorded in pileSeq, and the shown-trick loop below
  // floors the next trick's play delays at it — no flight of trick N+1
  // starts before trick N's collection has finished.
  const frameNow = seqClock.current;
  if (playRests.current.hand !== handNo) playRests.current = { hand: handNo, rests: new Map() };
  if (playStarts.current.hand !== handNo) playStarts.current = { hand: handNo, starts: new Map() };
  const newestPile = piles[piles.length - 1];
  const newestPileId = newestPile ? newestPile.plays.map((pl) => `${handNo}-${pl.card}`).join(',') : '';
  let freshPile: Trick | null = null;
  if (pileSeq.current.hand !== handNo) {
    // First render of a hand (fresh table or a resumed one): piles already
    // stacked are history, not a completion — pre-seed so nothing re-anchors.
    pileSeq.current = { hand: handNo, seenPileId: newestPileId, sweepUntil: 0, anchorPileId: '', anchorStart: 0 };
  } else if (newestPile && newestPileId !== pileSeq.current.seenPileId) {
    pileSeq.current.seenPileId = newestPileId;
    freshPile = newestPile;
    const plain = !newestPile.plays.some((pl) => pl.run) && !isNukeTrick(newestPile.plays);
    let start = frameNow;
    if (plain && props.reviewHoldMs) {
      const lastRest = lastRestFrameSec(newestPile.plays.map((pl) => playRests.current.rests.get(`${handNo}-${pl.card}`)));
      start += reviewDelaySec({ lastRestFrameSec: lastRest, holdSec: props.reviewHoldMs / 1000, nowFrameSec: frameNow });
    }
    // The anchor names the frame the fresh pile's sweep starts. Every later
    // render re-derives the item delay as the remainder to that same frame
    // (never a fresh full delay), so a held sweep's wait and Card3D's own
    // frame-clock elapsing of it agree (sweepGate.ts).
    pileSeq.current.anchorPileId = newestPileId;
    pileSeq.current.anchorStart = start;
  }
  // Delay the anchored (newest) pile's items still owe before their sweep
  // starts — the full review delay on the flip render, decaying on the frame
  // clock afterwards; 0 once the start frame has passed (items adopted by
  // then ignore the prop, and a rested card's sweep is already running).
  const anchorDelay = newestPile && pileSeq.current.anchorPileId === newestPileId
    ? Math.max(0, pileSeq.current.anchorStart - frameNow)
    : 0;
  let freshPileEnd = 0;
  for (const t of piles) {
    const w = t.winner!;
    const k = pileCount[w]!++;
    const anchored = t === newestPile && anchorDelay > 0;
    const fresh = t === freshPile;
    t.plays.forEach((pl, j) => {
      if (collecting) {
        const delay = Math.max(w * 0.5 + k * 0.08, anchored ? anchorDelay : 0);
        if (fresh) freshPileEnd = Math.max(freshPileEnd, delay + 0.7 + SEQUENCE_FRAME_SLACK_SEC);
        items.push({ key: `${handNo}-${pl.card}`, card: pl.card, target: collectTarget, duration: 0.7, arc: 0.25, motion: 'glide', delay, sfxStart: 'sweep', spatialSeat: positions[w]!, spatialN: n });
      } else {
        const delay = anchored ? anchorDelay : 0;
        if (fresh) freshPileEnd = Math.max(freshPileEnd, delay + 0.55 + SEQUENCE_FRAME_SLACK_SEC);
        items.push({ key: `${handNo}-${pl.card}`, card: pl.card, target: pileSpot(positions[w]!, n, k, j, jitterOf(pl.card)), duration: 0.55, arc: 0.15, motion: 'gather', ...(delay > 0 ? { delay } : {}), sfxStart: 'sweep', spatialSeat: positions[w]!, spatialN: n });
      }
    });
  }
  if (freshPile) pileSeq.current.sweepUntil = Math.max(pileSeq.current.sweepUntil, sweepEndFrameSec(frameNow, freshPileEnd));
  // cards on the table this trick
  // legacy last-trick nuke stagger (the engine no longer auto-plays: an armed nuke waits for every
  // seat to throw): auto-played cards from older games still fly in one after another
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
  // Toss variation (owner, 2026-10-30): fold the completed tricks' plays through
  // the toss picker (same playSeed grain as the toss height and the physics
  // landing) so this trick's first toss never repeats the previous play's toss.
  let prevVariantId: FlightVariantId | undefined;
  piles.forEach((pile, ti) => { pile.plays.forEach((pp) => { prevVariantId = pickFlightVariant(playSeed(props.gameSeed ?? '', handNo, ti, pp.card), prevVariantId).id; }); });
  const deuceByCard = new Map<Card, DeuceFxInfo>();
  shownTrick.forEach((pl, order) => {
    const autoDelaySec = pl.auto ? 0.35 + 0.12 * (order - firstAuto) : 0;
    const leftHand = pl.seat === human ? departureSlot(held.current.slots, held.current.cards, pl.card) : undefined;
    const playKey = `${handNo}-${pl.card}`;
    const fanRest = restFor(pl.seat);
    const fan = pl.seat === human ? undefined : opponentFan(positions[pl.seat]!, n, Math.max(0, handCounts[pl.seat]! - 1) / 2, handCounts[pl.seat]! + 1, fanRest.drop, fanRest.pinch);
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
    const dfx = props.deuceFx?.(pl.card) ?? null;
    if (dfx) deuceByCard.set(pl.card, dfx);
    // A marquee Cut (deuceFx.ts) keeps its tuned over-cut flight even though
    // its composed cue no longer carries the segment — the clash replaced
    // the popup treatment, not the flight. Trump-led steals never had that
    // flight (wasOvercut false) and keep their toss, exactly as before.
    const overcut = props.landCue(pl.card).includes(',overcut') || !!dfx?.wasOvercut;
    const flight = overcut ? { duration: 0.34, arc: 0.7 } : dragged ? { duration: feel.duration, arc: feel.arc } : { duration: 0.5, arc: 0.35 * toss };
    // Toss family (owner, 2026-10-30): every played card draws a toss from the
    // seeded family — never the same family member twice in a row — while the
    // flick gesture overrides with its own flat skim toss built from the
    // release vector. Dragged/slam plays keep their tuned feel untouched, and
    // a physics landing keeps its capped hop (only the curve/spin ride along).
    const picked = pickFlightVariant(playSeed(props.gameSeed ?? '', handNo, trickNo, pl.card), prevVariantId);
    prevVariantId = picked.id;
    const flickV = !land && !dragged && !overcut && !reduced ? flickFlightFor(pl.rel) : null;
    const variant: FlightVariant | undefined = dragged || overcut ? undefined : flickV ? flickV : land ? { curve: picked.variant.curve, spin: picked.variant.spin } : picked.variant;
    // Serialization (sweepGate.ts): this flight never starts before the
    // previous trick's collection has finished — its delay is floored at
    // that sweep's end frame, the same way the auto-play stagger floors it
    // in time. Whose turn it is, prompts and timers are untouched; only
    // the flight's start waits.
    // Bot pacing (sweepGate.ts spacedPlayDelaySec): a bot play ALSO keeps
    // its seeded pacing draw as a minimum spacing after the previous
    // play's flight start, so the sweep floor shifting one flight cannot
    // bunch the next bot's card against it — the rhythm the scheduler
    // (useGame / the server room) drew is the rhythm the table shows.
    // Human-seat plays (and legacy auto / Run It plays) take the plain
    // serialization, exactly as before.
    const pace = props.botPace;
    const isBotPlay = !!pace && !pl.auto && !pl.run && pace.botSeats.includes(pl.seat);
    const prevPl = order > 0 ? shownTrick[order - 1] : undefined;
    const playDelay = isBotPlay
      ? spacedPlayDelaySec({
        itemDelaySec: autoDelaySec,
        sweepEndFrameSec: pileSeq.current.sweepUntil,
        prevStartFrameSec: prevPl ? playStarts.current.starts.get(`${handNo}-${prevPl.card}`) ?? null : null,
        spacingSec: (botPaceDelayMs({
          seed: props.gameSeed ?? '', handNo, trickNo, seat: pl.seat, position: order,
          playerCount: n, kind: 'play', baseMs: pace.baseMs,
          jokerDown: shownTrick.slice(0, order).some((p) => isJoker(p.card)),
        }) * pace.speedK) / 1000,
        nowFrameSec: frameNow,
      })
      : serializedPlayDelaySec({ itemDelaySec: autoDelaySec, sweepEndFrameSec: pileSeq.current.sweepUntil, nowFrameSec: frameNow });
    // Stamp the predicted rest (this build frame + delay + duration, on the
    // same capped-dt frame time Card3D flies on) so this trick's gather can
    // be anchored to its last card's rest when it completes. First show
    // only: a later render must not push the rest past the flight already
    // in the air. The flight's start is stamped alongside (same first-show
    // rule) for the next bot play's spacing.
    if (launches) {
      playRests.current.rests.set(playKey, playRestFrameSec(frameNow, playDelay, flight.duration));
      playStarts.current.starts.set(playKey, frameNow + playDelay);
    }
    items.push({ key: playKey, card: pl.card, public: true, target: trickSpot(positions[pl.seat]!, n, order, jitterOf(pl.card), trickScale, land), from, origin, slam: dragged ? feel : { ...feel, intensity: -1 }, ...flight, variant, ...(land && reduced ? { motion: 'slide' as const, arc: 0 } : land && !overcut ? { motion: 'glide' as const, arc: Math.min(0.3, flight.arc) } : flickV ? { motion: 'flick' as const } : {}), sfxLand: props.landCue(pl.card), spatialSeat: positions[pl.seat]!, spatialN: n, glow: !!props.marked?.includes(pl.card), armed: false, ...(playDelay > 0 ? { delay: playDelay } : {}) });
  });
  // Deuce Drop / Cut threading (deuceFx.ts): the stealer's item carries its
  // impact; the beaten trump's item carries the knock direction (away from
  // the stealer's landing spot), and the fx layer gets the victim's resting
  // pose for its crack of light + spark midpoint. Both cards are items of
  // this same trick — the victim was pushed by an earlier pass of the loop.
  if (deuceByCard.size) {
    const trickCards = new Set(shownTrick.map((pl) => pl.card));
    const byCard = new Map<Card, Item>();
    for (const it of items) if (it.public && it.card && trickCards.has(it.card)) byCard.set(it.card, it);
    for (const [card, dfx] of deuceByCard) {
      if (!dfx.drop && !dfx.cut) continue;
      const mine = byCard.get(card);
      if (!mine) continue;
      mine.impactFx = { kind: dfx.cut ? 'cut' : 'drop', victim: dfx.cut?.victim ?? null };
      if (dfx.cut) {
        const victim = byCard.get(dfx.cut.victim);
        if (victim) {
          const dx = victim.target.p[0] - mine.target.p[0];
          const dz = victim.target.p[2] - mine.target.p[2];
          const len = Math.hypot(dx, dz) || 1;
          const dirX = dx / len;
          const dirZ = dz / len;
          victim.knock = { dirX, dirZ };
          setDeuceCutPose(dfx.cut.victim, { x: victim.target.p[0], y: victim.target.p[1], z: victim.target.p[2], dirX, dirZ });
        }
      }
    }
  }
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
      const seatRest = restFor(seat);
      const from = leftHand ?? (seat === human ? undefined : opponentFan(positions[seat]!, n, Math.min(i, k - 1), k, seatRest.drop, seatRest.pinch));
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
      const s2Rest = restFor(s2);
      const from = leftHand ?? (s2 === human ? undefined : opponentFan(positions[s2]!, n, 0, 1, s2Rest.drop, s2Rest.pinch));
      items.push({ key: `${handNo}-${c}`, card: c, public: true, target, from, origin: leftHand, delay: 0.38 + i * 0.03, duration: 0.18, arc: 0.25 });
    });
  }
  // opponents' fans
  for (let seat = 0; seat < n && !held0; seat++) {
    if (seat === human) continue;
    const c = handCounts[seat]!;
    for (let i = 0; i < c; i++) {
      if (gather) {
        items.push({ key: `${handNo}-b${seat}-${i}`, card: null, target: deck, duration: 0.7, arc: 0.25, motion: 'glide', delay: seat * 0.07 + i * 0.015, sfxStart: 'sweep', spatialSeat: positions[seat]!, spatialN: n });
      } else {
        const rest = restFor(seat);
        items.push({ key: `${handNo}-b${seat}-${i}`, card: null, target: opponentFan(positions[seat]!, n, i, c, rest.drop, rest.pinch), from: flight ? deck : undefined, delay: flight ? dealDelay(i, seat) : 0, holdUntilMove: flight, duration: !flight && rest.moving ? rest.durSec : tl.fly, arc: 0.3, sfxStart: 'deal', spatialSeat: positions[seat]!, spatialN: n });
      }
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
  // A selected card raises screen-up in place. It used to also slide its neighbours
  // apart (spread: RAISE_SPREAD), which made the solver shrink the whole fan to
  // reserve that room and drop the entire hand on the first tap. The fan is now laid
  // out identically whether or not a card is selected: the same opts lay out every
  // mesh and every hit quad, and only the raised card moves.
  const humanRest = restFor(human);
  const laid: FanOpts = { ...fanOpts, rest: humanRest.drop, pinch: humanRest.pinch };
  const fan = fanLayout(aspect, Math.max(1, fanCards.length), safeFrac, laid);
  const cardPx = fanCssPx(fan, screenW).width;
  // No neighbour spread on selection: the fan anchor must not move when a card raises.
  const rawSpread = raiseSpreadPx(fanCards.length, -1, cardPx, undefined);
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
    const targetStock = handFan(aspect, fanCards.length, i, 0, safeFrac, opts, gaps[i] ?? 0, screenH);
    // People framing (pilot): the slot the mesh flies to is the refit
    // of the solved slot; the hit quad below keeps the stock target —
    // the refit preserves its screen position exactly.
    const target = refitM ? refitXf(targetStock) : targetStock;
    // One shot. Later renders (a tap, a highlight) must not pass the face-down pose again.
    const flip = flipIn && flippedHand.current !== handNo && !!c;
    const id = c ? handCardKey(c) : '';
    const slotKey = handSlotKey(id, i);
    // Already in the hand: sit in the fan this frame. Flying in from the deck is what left
    // cards missing after the state had moved on, and those hidden meshes ignore taps.
    const dealIn = handDealsIn({ intro: flight, dealing: !!props.dealing, flip });
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
        poly: cardScreenQuad(aspect, targetStock, screenW, screenH, posePx(pose), !!fanOpts.short, view),
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
      duration: move.kind === 'flip' ? 0.34 : move.kind === 'deal' ? tl.fly : humanRest.moving ? humanRest.durSec : move.kind === 'slide' ? GAP_S : handSpreadProbe(spreadSeconds()),
      // Rest transition: ride Card3D's slide tween (liftEase) instead of the
      // 'lift' snap, so the fan eases down/up over FAN_REST_MS. The hit quads
      // published this render are the destination pose, as with a gap-close
      // slide, and the fan is fully open before the human can be asked to tap
      // (the state keys off the same acting-seat signal as `legal`).
      motion: humanRest.moving && (move.kind === 'lift' || move.kind === 'slide') ? 'slide' as const : move.motion,
      arc: dealIn ? 0.3 : move.arc,
      raise: c ? raiseLocalY(pose, fan.viewH, screenH, fan.ch) : 0,
      roll: plane.roll,
      order,
      // Misdeal gather: my fan rides the same collection glide into the deck as every other hand.
      ...(gather ? { target: deck, from: undefined, delay: i * 0.02, holdUntilMove: false, sfxStart: 'sweep' as const, dim: false, tap: null, duration: 0.7, motion: 'glide' as const, arc: 0.25, raise: 0 } : {}),
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
  // While cards are being thrown in (gather) or dealt out (flight), the fan is not a tap target.
  const dealingNow = (flight || gather) && !!props.dealing;
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
          variant={it.variant}
          raise={it.raise}
          roll={it.roll}
          order={it.order}
          dim={it.dim}
          glow={it.glow}
          armed={it.armed}
          castShadow={it.shadow !== false && quality === 'high'}
          quality={quality}
          cardId={it.cardId ?? it.card}
          onTap={it.tap}
          sfxStart={it.sfxStart}
          sfxLand={it.sfxLand}
          impactFx={it.impactFx}
          knock={it.knock}
          spatialSeat={it.spatialSeat}
          spatialN={it.spatialN}
          holdUntilMove={it.holdUntilMove}
          blast={it.hand ? 'hand' : 'table'}
        />
      ))}
      {wide && !peopleCam && mine.length > 0 && <HandGlow aspect={aspect} count={mine.length} safeFrac={safeFrac} opts={fanOpts} />}
      {flight && <ShuffleDeck key={`shuffle-${handNo}`} at={deck} back={back} tl={tl} quality={quality} />}
      {props.kingGunSeat != null && positions[props.kingGunSeat] && (
        <KingGun spot={kingGunSpot(positions[props.kingGunSeat]!, n)} quality={quality} />
      )}
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

  // Joint plate layout (three/plateLayout.ts): all three upper plates are
  // solved ONCE per call from position-independent inputs — projected
  // anchors, measured plate SIZES and relative offsets (bubble/tag
  // overhangs shift with the plate's own rect, so where the plate was last
  // applied cancels out), the static bar / trick slots / HUD rects. The old
  // per-plate callbacks read each other's live rects and a dataset.moved
  // flag, and the partner plate's clamped rest position sits exactly on
  // the side plates' hit threshold — so at certain tilts the partner plate
  // snapped up and down forever (owner 2026-10-30). Nothing here reads an
  // applied plate position as another plate's obstacle, so the solve is a
  // fixed point: applying its output cannot change its next output.
  const solveAll = (camera: Camera, size: { width: number; height: number }) => {
    const pad = 6 + safeFrac * size.width;
    const stripR = document.querySelector('.trump-strip')?.getBoundingClientRect();
    const bugR = document.querySelector('.scorebug .bug')?.getBoundingClientRect();
    const barFloor = stripR && stripR.height > 0 ? stripR.bottom : bugR ? bugR.bottom : size.width >= 900 ? 106 : 122;
    const slots = trickRects(camera, size, positions, n);
    const hud: PlateRect[] = [...document.querySelectorAll<HTMLElement>(`.ctl-cluster, .last-trick, .chat-toggle, .me-plate, .me-plate .plate-turn, .me-plate .vbubble, .center-note`)]
      .map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0)
      .map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom }));
    const proj = (p: (typeof positions)[number]) => {
      const v = new Vector3(...badgeSpot(p, n)).project(camera);
      return { x: (v.x + 1) * size.width / 2, y: (1 - v.y) * size.height / 2 };
    };
    // a measured rect shifted by a delta — used to re-derive a child's
    // (bubble's) rect at a seat's natural position from its offset to the
    // plate's own measured centre, so the applied position cancels
    const shifted = (r: DOMRect, dx: number, dy: number): PlateRect =>
      ({ left: r.left + dx, right: r.right + dx, top: r.top + dy, bottom: r.bottom + dy });
    let top: TopPlateGeom | null = null;
    let topFallback: { cx: number; cy: number } | null = null;
    const sides: SidePlateGeom[] = [];
    const sideFallbacks = new Map<number, [number, number]>();
    positions.forEach((p, seat) => {
      if (seat === human) return;
      const a = proj(p);
      if (p === 'top') {
        // measured (plate + video bubble) so it stays clear of the right edge and below the trump strip
        const plate = portal.current?.querySelector<HTMLElement>('.seat-anchor.side-top > .plate');
        const pr = plate?.getBoundingClientRect();
        const br = plate?.querySelector('.vbubble')?.getBoundingClientRect();
        const pw = pr && pr.width ? Math.max(pr.right, br?.right ?? 0) - Math.min(pr.left, br?.left ?? Infinity) : 190;
        const ph = pr && pr.width ? Math.max(pr.height, br?.height ?? 0) : 56;
        const left = br && pr ? Math.max(0, pr.left - br.left) : 0;
        // the "TO PLAY" tag / bubble can reach above the plate: keep all of it under the bar
        const tr = plate?.querySelector('.plate-turn')?.getBoundingClientRect();
        const up = pr && pr.width ? Math.max(ph / 2, (pr.top + pr.bottom) / 2 - Math.min(pr.top, br && br.height ? br.top : Infinity, tr && tr.height ? tr.top : Infinity)) : ph / 2;
        const minY = barFloor + 8 + up;
        // the plate is horizontally centered on the anchor (CSS translate(-50%)), so clamp the center point
        const cx = Math.max(pad + pw / 2 + left / 2, Math.min(a.x, size.width - pad - pw / 2 + left / 2));
        const cy = Math.max(a.y, minY);
        topFallback = { cx, cy };
        if (pr && pr.width) {
          const body: PlateRect = { left: cx - pr.width / 2, right: cx + pr.width / 2, top: cy - pr.height / 2, bottom: cy + pr.height / 2 };
          const bubble = br && br.height ? shifted(br, cx - (pr.left + pr.right) / 2, cy - (pr.top + pr.bottom) / 2) : null;
          const union: PlateRect = bubble
            ? { left: Math.min(body.left, bubble.left), right: Math.max(body.right, bubble.right), top: body.top, bottom: Math.max(body.bottom, bubble.bottom) }
            : body;
          top = { cx, cy, minY, ph, body, union, bubble };
        }
      } else if (p === 'left' || p === 'right') {
        const side = p;
        const ax = side === 'left' ? Math.max(pad, a.x - 72) : Math.min(size.width - pad, a.x + 72);
        const plate = portal.current?.querySelector<HTMLElement>(`.seat-anchor.side-${side} > .plate`);
        const pr = plate?.getBoundingClientRect();
        if (!plate || !pr || !pr.width) { sideFallbacks.set(seat, [ax, Math.max(a.y, barFloor + 8 + 28)]); return; } // 28 = half the 56px fallback plate height, as in the top branch
        // how far above the plate's centre anything reaches (the TO PLAY tag pokes over the top)
        const tagR = plate.querySelector('.plate-turn')?.getBoundingClientRect();
        const up = Math.max(pr.height / 2, tagR && tagR.height ? (pr.top + pr.bottom) / 2 - tagR.top : 0);
        const narrow = plate.classList.contains('narrow');
        if (!narrow) plate.dataset.wideW = String(pr.width);
        const wideW = Number(plate.dataset.wideW) || pr.width;
        if (narrow) plate.dataset.narrowW = String(pr.width);
        const narrowW = Number(plate.dataset.narrowW) || null;
        const cy0 = plateCy0(a.y, barFloor, up);
        const ccx = side === 'left' ? ax + pr.width / 2 : ax - pr.width / 2;
        const body: PlateRect = { left: ccx - pr.width / 2, right: ccx + pr.width / 2, top: cy0 - pr.height / 2, bottom: cy0 + pr.height / 2 };
        const br = plate.querySelector('.vbubble')?.getBoundingClientRect();
        const bubble = br && br.height ? shifted(br, ccx - (pr.left + pr.right) / 2, cy0 - (pr.top + pr.bottom) / 2) : null;
        sides.push({ side, ax, y: a.y, pw: pr.width, ph: pr.height, up, wideW, narrowW, body, bubble });
      }
    });
    const input: PlateSolveInput = { width: size.width, height: size.height, barFloor, slots, hud, top, sides };
    const solve = solvePlates(input);
    const w = window as unknown as { __bwmPlateDbg?: Record<string, unknown>; __bwmLayout?: unknown };
    const dbg = w.__bwmLayout ? (w.__bwmPlateDbg ??= {}) : undefined;
    if (dbg) for (const s of sides) {
      const out = solve.sides[s.side];
      if (out) dbg[s.side] = { y: s.y, cy: out.cy0, pw: s.pw, ph: s.ph, tp: input.top && [input.top.union.top, input.top.union.bottom], cands: out.cands.map((c) => [...c.map(Math.round)]), slots: slots.map((t) => [t.left, t.top, t.right, t.bottom].map(Math.round)) };
    }
    return { solve, topFallback, sideFallbacks };
  };

  return (
    <>
      {positions.map((p, seat) => {
        if (seat === human) return null;
        const side = p === 'left' || p === 'right' ? p : p === 'top' ? 'top' : null;
        // phone landscape: plates pinned to the screen edges at mid-height, partner top-centre under the scorebug
        if (short && side) {
          const cls = side === 'top' ? 'side-topc' : `side-${side}`;
          // top seat: plate sits just left of the partner's cards (not in the corner), lowered a touch — Demetrius 2026-10-19
          // the right plate's right edge IS its anchor (CSS translate(-100%, -50%)), and the
          // controls rail owns the right-edge lane: 8px offset + 42px button = a 50px footprint
          // (see the .ctl-rail note in styles.css). Anchoring at width - 8 put the plate's tail
          // — the chips and the TOOK stat — under the rail (owner 2026-10-22, iPhone landscape);
          // stop 58px in: the rail's footprint plus the same 8px gap the last-trick chip uses.
          const calcShort = (el: Object3D, camera: Camera, size: { width: number; height: number }) =>
            side === 'top' ? [(size.width / 2) - 170, 68 + safe.t] : side === 'left' ? [8 + safe.l, size.height * (n === 3 ? 0.36 : 0.43)] : [size.width - 58 - safe.r, size.height * (n === 3 ? 0.36 : 0.43)];
          return (
            <Html key={seat} position={badgeSpot(p, n)} calculatePosition={calcShort} zIndexRange={[5, 0]} className={`seat-anchor ${cls}`} portal={portal}>
              {renderSeat(seat)}
            </Html>
          );
        }
        // side plates are anchored by their outer edge and clamped inside the viewport (+ iOS safe area);
        // every plate's position is its slice of the one joint solve (see solveAll above)
        const calc = side
          ? (el: Object3D, camera: Camera, size: { width: number; height: number }) => {
            const { solve, topFallback, sideFallbacks } = solveAll(camera, size);
            if (side === 'top') {
              const t = solve.top ?? topFallback;
              return t ? [t.cx, t.cy] : [size.width / 2, size.height / 2];
            }
            const fb = sideFallbacks.get(seat);
            if (fb) return fb;
            const s = solve.sides[side];
            if (!s) return [0, 0];
            const plate = portal.current?.querySelector<HTMLElement>(`.seat-anchor.side-${side} > .plate`);
            if (plate) {
              // outputs only: the narrow composition and the moved mirror are
              // written from the solve, never read back into it
              if (s.wantNarrow !== plate.classList.contains('narrow')) { plate.classList.toggle('narrow', s.wantNarrow); invalidate(); } // re-measured next frame
              if (s.moved) plate.dataset.moved = '1'; else delete plate.dataset.moved;
            }
            return [s.x, s.cy];
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
  // Crash telemetry: the Scene's mount/unmount brackets "at a table" for the
  // unclean-exit witness, and the venue/quality/stop ride every report made
  // while this table is up. Observation only — no behavior change.
  useEffect(() => {
    noteCrumb('scene-mount', `${def.id} ${props.quality}${props.storyStopId ? ` stop=${props.storyStopId}` : ''}`);
    return () => { noteCrumb('scene-unmount', def.id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    setCrashContext({ venue: def.id, quality: props.quality, storyStop: props.storyStopId ?? null });
  }, [def.id, props.quality, props.storyStopId]);
  // Seated figures (the Porch pilot, rolled out route-wide): the
  // figures seat only where Table says a story cast sits, at High,
  // and only at a stop with a seat config (three/figureSeats.ts) —
  // the King stop has none: its seated figures ride KingRail.
  const figureSeatConfig = props.storyStopId ? FIGURE_SEAT_CONFIGS[props.storyStopId] : undefined;
  const storyFiguresActive = hi && !!figureSeatConfig && !!(props.figureSeats?.some(Boolean));
  // Persona figures (regular tables): bot seats at NON-story tables,
  // High only. Story tables never mount them (their cast system owns
  // the seats), whatever the prop carries.
  const personaFiguresActive = !props.storyStopId && hi && !!(props.personaFigureSeats?.some(Boolean));
  const [showTable, setShowTable] = useState(false);
  const [lit, setLit] = useState(false);
  const [shadowSize, setShadowSize] = useState(0);
  const [dprCap, setDprCap] = useState(1);
  const [textured, setTextured] = useState(false);
  const [hallGo, setHallGo] = useState(false);
  // WebGL context-loss recovery (crash hardening, 2026-10-30): when the
  // GPU context dies and the browser restores it, three re-inits the
  // renderer with EMPTY resource records — but React-side state built
  // on the dead context (a figure boundary that tripped on a throw
  // during the loss, render targets, video textures) only rebuilds on
  // a remount. The restore listener in onCreated bumps this epoch,
  // which re-mounts the scene's resource subtree INSIDE the table:
  // the player sees the table flicker and rebuild around their hand.
  // No route change, no reload — game state lives in Table's props
  // and is never touched.
  const [glEpoch, setGlEpoch] = useState(0);
  // Drag-to-play: the card under the finger is drawn by the lifted copy, so its slot in the fan is left open.
  const [dragCard, setDragCard] = useState<Card | null>(null);
  const onTableReady = props.onTableReady;
  const tableReady = useCallback(() => { onTableReady?.(); }, [onTableReady]);
  const onFirstFrameProp = props.onFirstFrame;
  const firstFrame = useCallback(() => { onFirstFrameProp?.(); }, [onFirstFrameProp]);
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
        // WebGL context loss: memory pressure's canary, and until now
        // completely unobserved — no listener existed anywhere, so a lost
        // context surfaced only as a dead scene or a later boundary bounce.
        // These listeners only REPORT (no preventDefault, no recovery
        // change); a restore-handling fix is its own lane.
        gl.domElement.addEventListener('webglcontextlost', () => {
          noteCrumb('webgl', 'lost');
          reportCrash('webgl-lost', new Error('WebGL context lost'), { venue: def.id, quality: props.quality });
        });
        gl.domElement.addEventListener('webglcontextrestored', () => {
          noteCrumb('webgl', 'restored');
          reportCrash('webgl-restored', new Error('WebGL context restored'), { venue: def.id, quality: props.quality });
        });
        // Recovery (crash hardening, 2026-10-30): the reporting pair
        // above observes; this pair RECOVERS, and both stay. Our own
        // preventDefault on the loss keeps the context restorable
        // (three's renderer calls it too — belt and braces, so the
        // guarantee lives in app code, not a library habit), and the
        // restore bumps glEpoch to remount the scene's resource
        // subtree in place (see the state declaration). Listeners are
        // additive: registering ours after telemetry's changes neither
        // its firing nor its reports.
        gl.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); });
        gl.domElement.addEventListener('webglcontextrestored', () => { setGlEpoch((n) => n + 1); });
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
      // Rotation perf (2026-10-29): the measure debounce is TRAILING, and
      // window-resize / orientationchange feed it directly — at 50ms a
      // rotation's event stream (Safari fires intermediate sizes faster
      // than the debounce under load, and Playwright/device streams space
      // them wider) committed nearly every intermediate size, and each
      // commit reallocates the MSAA drawing buffer + re-renders the whole
      // scene (the exact long-task cost ResumeRamp's comment documents at
      // mount). 200ms collapses a flip to a single settled size commit;
      // the canvas CSS box already tracks the container, so the old buffer
      // simply stretches for the beat the OS spends rotating anyway.
      // Follow-up (same day): that trailing commit also landed the new
      // orientation LATE on a real phone ("after a while it expands") —
      // the stream runs for hundreds of ms, so the settled commit trailed
      // it by another 200ms. SizeLeader (below) restores the leading edge:
      // it commits ONCE when the box's aspect class flips (an orientation
      // crossing — a cadence-based leader re-committed at intermediate
      // sizes during continuous streams, 9–11 reallocs on the storm rig);
      // this debounced measure remains as the slow net, and where both
      // land on the same size the second commit is a no-op.
      resize={{ debounce: 200 }}
    >
      <AspectWatcher onAspect={setAspect} />
      <SizeLeader />
      <PresentedProbe />
      <OrientationRehearsal ready={textured} />
      <EffectWarmup quality={props.quality} />
      <SnapHook />
      <FirstFrameSignal onFirstFrame={firstFrame} />
      <CameraRig view={props.view} people={storyFiguresActive} />
      <ViewAdjustControls />
      <FxShake table={tableGroup} />
      {/* Everything from here down owns GPU resources (rooms, table,
          cards, figures, effects, badges). The keyed Fragment is the
          context-restore remount: bumping glEpoch rebuilds exactly
          this subtree against the restored context while the Canvas,
          the camera rig and the controls above never unmount. */}
      <Fragment key={glEpoch}>
      <color attach="background" args={[def.clear]} />
      {classic && <fog attach="fog" args={['#0c0712', 7, 16]} />}
      <Lights quality={props.quality} def={def} shadowSize={shadowSize} />
      {/* The hall is filtered one mip per frame, and only after the cloth maps are on the table.
          drei's <Preload all> stays out: it compiled and rendered a cube camera inside useLayoutEffect. */}
      <ResumeRamp quality={props.quality} def={def} onShow={onShow} onLit={onLit} onDpr={onDpr} onShadow={onShadow} onHall={onHall} />
      {hi && classic && <HallAttach active={hallGo && textured} />}
      {!classic && !cubeRoom && textured && <Venue3D key={def.id} def={def} quality={props.quality} reduceFx={!!props.reduceFx} handKey={props.handNo} storyStopId={props.storyStopId ?? null} />}
      {classic && textured && (props.storyStopId === 'rec-center' && props.quality === 'high'
        ? <RecCenterGymRoom fxOn={!props.reduceFx} />
        : <ClassicStudio quality={props.quality} />)}
      {barbershop && textured && (props.quality === 'high'
        ? <BarbershopMirrorRoom fxOn={!props.reduceFx} />
        : <BarbershopRoom quality={props.quality} handNo={props.handNo} />)}
      {rooftop && textured && (props.storyStopId === 'rooftop' && props.quality === 'high'
        ? <RooftopDuskRoom fxOn={!props.reduceFx} />
        : props.quality === 'high'
          ? <RooftopSkylineRoom fxOn={!props.reduceFx} handNo={props.handNo} />
          : <RooftopRoom quality={props.quality} handNo={props.handNo} />)}
      {yacht && textured && (props.quality === 'high'
        ? <YachtDeckRoom fxOn={!props.reduceFx} />
        : <YachtRoom quality={props.quality} handNo={props.handNo} />)}
      {beach && textured && (props.quality === 'high'
        ? <BeachCabanaRoom fxOn={!props.reduceFx} />
        : <BeachRoom quality={props.quality} handNo={props.handNo} />)}
      {backyard && textured && (props.quality === 'high'
        ? <CookoutYardRoom fxOn={!props.reduceFx} />
        : <BackyardRoom quality={props.quality} handNo={props.handNo} />)}
      {church && textured && (props.quality === 'high'
        ? <ChurchBasementRoom fxOn={!props.reduceFx} />
        : <ChurchRoom quality={props.quality} handNo={props.handNo} />)}
      {vegas && textured && (props.storyStopId === 'legends' && props.quality === 'high'
        ? <LegendsTableRoom fxOn={!props.reduceFx} />
        : props.quality === 'high'
          ? <VegasCasinoRoom fxOn={!props.reduceFx} />
          : <VegasRoom quality={props.quality} handNo={props.handNo} />)}
      {speakeasy && textured && (props.storyStopId === 'corner' && props.quality === 'high'
        ? <CornerStreetRoom fxOn={!props.reduceFx} />
        : props.quality === 'high'
          ? <SpeakeasyLoungeRoom fxOn={!props.reduceFx} />
          : <SpeakeasyRoom quality={props.quality} handNo={props.handNo} />)}
      {grandma && textured && (props.storyStopId === 'porch' && props.quality === 'high'
        ? <PorchDeckRoom />
        : props.quality === 'high'
          ? <GrandmasKitchenRoom fxOn={!props.reduceFx} />
          : <GrandmaRoom quality={props.quality} handNo={props.handNo} />)}
      {mansion && textured && (props.quality === 'high'
        ? <HighRisePenthouseRoom fxOn={!props.reduceFx} />
        : <MansionRoom quality={props.quality} handNo={props.handNo} />)}
      {showTable && (
        <group
          ref={tableGroup}
          onPointerDown={(e) => {
            if (cardIdFromHit(e.object)) return;
            e.stopPropagation();
            props.onFeltTap?.();
          }}
        >
          <TableModel quality={props.quality} lit={lit} onReady={tableReady} onTextured={onTextured} def={def} roomFloor={classic && props.storyStopId === 'rec-center' && props.quality === 'high'} />
        </group>
      )}
      {showTable && props.positions.map((p, seat) => <TurnRing key={seat} pos={p} n={props.n} active={props.turnSeat === seat} />)}
      {showTable && <Cards key={props.dealEpoch ?? 0} {...props} dragCard={dragCard} aspect={aspect} fontsReady={fontsReady} safeFrac={safeFrac} lit={lit} />}
      {showTable && props.crowdCue && ((props.kingRailCast?.length ?? 0) > 0 || (props.seatedFigures ?? []).some(Boolean)) && (
        <KingRail
          cast={props.kingRailCast ?? []}
          seated={props.seatedFigures ?? []}
          positions={props.positions}
          n={props.n}
          turnSeat={props.turnSeat ?? -1}
          cue={props.crowdCue}
          animate={props.crowdAnimate ?? false}
          visit={props.visitRail ?? false}
          aspect={aspect}
          short={!!props.short}
        />
      )}
      {showTable && textured && storyFiguresActive && (
        <PorchFigures
          seats={props.figureSeats!}
          positions={props.positions}
          n={props.n}
          handCounts={props.handCounts}
          activeSeat={props.activeSeat ?? null}
          view={props.view ?? 'standing'}
          animate={props.crowdAnimate ?? false}
          seatConfig={figureSeatConfig}
        />
      )}
      {showTable && textured && personaFiguresActive && (
        <PersonaFigures
          seats={props.personaFigureSeats!}
          positions={props.positions}
          n={props.n}
          handCounts={props.handCounts}
          activeSeat={props.activeSeat ?? null}
          view={props.view ?? 'standing'}
          animate={props.crowdAnimate ?? false}
          venue={def.id}
        />
      )}
      {showTable && (props.seatVideos?.some(Boolean) ?? false) && (
        <SeatVideoLayer
          seats={props.seatVideos!}
          positions={props.positions}
          n={props.n}
          human={props.human}
        />
      )}
      {showTable && <HandPointer onTap={props.onCardTap} onDrop={props.onCardDrop} legal={props.legal} onDragging={setDragCard} view={props.view} turnUp={props.turnUp} />}
      <DeuceFxLayer reducedProp={!!props.reduceFx} />
      <AfterTable quality={props.quality} tableUp={textured} trickArmed={!!props.trickArmed} />
      {layerReady && <Badges positions={props.positions} n={props.n} human={props.human} renderSeat={props.renderSeat} portal={badgeLayer} safeFrac={safeFrac} short={!!props.short} safe={props.safe ?? { l: 0, r: 0, t: 0, b: 0 }} />}
      </Fragment>
    </Canvas>
    <FlipCoverOverlay />
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
function AfterTable({ quality, tableUp, trickArmed }: { quality: 'high' | 'low'; tableUp: boolean; trickArmed?: boolean }) {
  const [nuke, setNuke] = useState<typeof import('./Nuke3D') | null>(null);
  const [tornado, setTornado] = useState<typeof import('./Tornado3D') | null>(null);
  const [wheels, setWheels] = useState<typeof import('./WheelsCar3D') | null>(null);
  useEffect(() => {
    if (!tableUp) return;
    let alive = true;
    const start = () => {
      // A deploy can delete the hashed file this page still names. Retry, then reload once.
      void importChunk(() => import('./Nuke3D')).then((m) => { if (alive) setNuke(m); }, () => {});
      void importChunk(() => import('./Tornado3D')).then((m) => { if (alive) setTornado(m); }, () => {});
      // The Wheels car rides the same lazy chunk family: mounting it here (its
      // model behind Suspense) quietly preloads the GLB after the felt is up.
      void importChunk(() => import('./WheelsCar3D')).then((m) => { if (alive) setWheels(m); }, () => {});
    };
    // Idle, after the cloth is on: the nuke shaders are not part of dealing a resumed hand back in.
    const ric = (window as unknown as { requestIdleCallback?: (fn: () => void, opts?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }).requestIdleCallback;
    const cancel = (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
    const id = ric ? ric(start, { timeout: 2500 }) : window.setTimeout(start, 800);
    return () => { alive = false; if (ric && cancel) cancel(id as number); else clearTimeout(id as number); };
  }, [tableUp]);
  if (!nuke && !tornado && !wheels) return null;
  return (
    <>
      {nuke && <nuke.NukeGlRecovery />}
      {nuke && <nuke.NukeGuard><nuke.Nuke3D quality={quality} /></nuke.NukeGuard>}
      {nuke && <nuke.NukeArmedGlow armed={!!trickArmed} />}
      {tornado && <tornado.Tornado3D quality={quality} />}
      {wheels && <wheels.default quality={quality} />}
    </>
  );
}

function AspectWatcher({ onAspect }: { onAspect: (a: number) => void }) {
  const size = useThree((s) => s.size);
  useEffect(() => { onAspect(size.width / size.height); }, [size, onAspect]);
  return null;
}

/**
 * Leading-edge size commits for rotation (see the Canvas resize note).
 * Observes the same box R3F's measure does (the wrapper div around the
 * canvas) and pushes a size change into the store without waiting out the
 * trailing debounce — but only when the change is an orientation CROSSING
 * (the box's aspect class flips vs the store's size). A crossing earns one
 * commit ~50ms later, reading the then-current rect: in a discrete phone
 * flip that is already the final size; in a continuous resize stream it is
 * a single mid-stream commit, and the debounced measure's trailing commit
 * lands the exact final size — ~2 buffer reallocs per flip, never the
 * per-step storm a cadence-based leader would reintroduce. Same-aspect
 * drift (chrome show/hide, height settling) is left entirely to the
 * trailing measure. orientationchange arms the same one-shot commit (a
 * no-op when the geometry has not landed yet — the crossing rule catches
 * the landing). Sizes are read with getBoundingClientRect, exactly like
 * the measure, and a commit matching the store's size (within half a
 * pixel) is skipped, so this never fights the debounced measure.
 */
function SizeLeader() {
  const setSize = useThree((s) => s.setSize);
  const get = useThree((s) => s.get);
  useEffect(() => {
    const el = get().gl.domElement.parentElement;
    if (!el) return;
    let timer = 0;
    const commit = () => {
      timer = 0;
      const r = el.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return;
      const st = get();
      const cur = st.size;
      if (Math.abs(cur.width - r.width) < 0.5 && Math.abs(cur.height - r.height) < 0.5) return;
      // Rotation round 3 (owner: first flip showed a BLACK canvas inside the
      // already-rotated chrome): a flip-class commit resets the drawing
      // buffer, and the cleared buffer is what the compositor would show
      // until the new size's first frame presents. Capture the live frame
      // into the flip-hold overlay BEFORE setSize clears it — the overlay
      // stays up until that first frame has presented (see flipHold.ts).
      const arFlip = Math.abs(Math.log((r.width / r.height) / (cur.width / cur.height))) > 0.35;
      if (arFlip) {
        captureFlipFrame(st.gl, st.scene, st.camera);
        noteFlipSizeCommit(r.width, r.height);
      }
      setSize(r.width, r.height);
    };
    const check = () => {
      const r = el.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return;
      const cur = get().size;
      if (Math.abs(cur.width - r.width) < 0.5 && Math.abs(cur.height - r.height) < 0.5) return;
      if ((r.width > r.height) === (cur.width > cur.height)) return; // same aspect class: the trailing net owns it
      if (!timer) timer = window.setTimeout(commit, 50);
    };
    const ro = new ResizeObserver(check);
    ro.observe(el);
    const onFlip = () => {
      // orientationchange fires while the geometry (and the canvas buffer)
      // is still the OLD orientation — the earliest safe moment to arm the
      // flip hold, before any size commit can clear the buffer.
      const st = get();
      captureFlipFrame(st.gl, st.scene, st.camera);
      if (!timer) timer = window.setTimeout(commit, 50);
    };
    window.addEventListener('orientationchange', onFlip);
    return () => { ro.disconnect(); window.removeEventListener('orientationchange', onFlip); if (timer) window.clearTimeout(timer); };
  }, [get, setSize]);
  return null;
}

/** Feeds presented frames to the flip hold (see flipHold.ts). */
function PresentedProbe() {
  const get = useThree((s) => s.get);
  useFrame(() => {
    const { width, height } = get().size;
    notePresentedFrame(width, height);
  });
  return null;
}

/**
 * The flip-hold overlay: a 2D canvas stretched over the WebGL canvas inside
 * the wrap. Hidden unless flipHold holds a captured frame; while held it
 * shows the table exactly as it was the instant before the buffer reset, so
 * a rotation never presents the cleared (black) buffer.
 */
function FlipCoverOverlay() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [, setGen] = useState(0);
  useEffect(() => {
    registerCover(ref.current);
    const off = subscribeFlipHold(() => setGen((g) => g + 1));
    return () => { off(); registerCover(null); };
  }, []);
  return <canvas ref={ref} className="flip-cover" style={{ display: flipHeld() ? 'block' : 'none' }} aria-hidden="true" />;
}

/**
 * Orientation rehearsal (rotation round 3): the FIRST flip at a table was
 * the black one because the alternate orientation's buffer size and first
 * full-size raster had never been trodden. Once the table is dressed and
 * the browser goes idle, quietly rehearse the other orientation under the
 * flip-hold cover: capture, setSize(swapped), let a frame present, restore.
 * From then on the owner's first real flip takes the warm path. Stands down
 * permanently if a real flip happens first; a real flip mid-rehearsal
 * always wins (noteFlipSizeCommit unlocks the hold and this stands down).
 */
function OrientationRehearsal({ ready }: { ready: boolean }) {
  const get = useThree((s) => s.get);
  const setSize = useThree((s) => s.setSize);
  const invalidate = useThree((s) => s.invalidate);
  const phase = useRef<'idle' | 'armed' | 'swapped' | 'restoring' | 'done'>('idle');
  const home = useRef<{ w: number; h: number } | null>(null);
  const ticks = useRef(0);
  const deadline = useRef(0);

  useEffect(() => {
    if (!ready || phase.current !== 'idle') return;
    phase.current = 'armed';
    let cancelled = false;
    const start = () => {
      if (cancelled || phase.current !== 'armed') return;
      if (flipUserFlipped() || flipRehearsed()) { phase.current = 'done'; return; }
      const st = get();
      const { width: w, height: h } = st.size;
      if (!(w > 40 && h > 40) || Math.abs(w - h) < 40) { phase.current = 'done'; return; }
      home.current = { w, h };
      if (!captureFlipFrame(st.gl, st.scene, st.camera)) { phase.current = 'done'; return; }
      setFlipHoldLock(true);
      phase.current = 'swapped';
      ticks.current = 0;
      deadline.current = performance.now() + 900;
      noteRehearsalSize(h, w);
      setSize(h, w);
      invalidate();
    };
    const w = window as unknown as { requestIdleCallback?: (fn: () => void, opts?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const id = w.requestIdleCallback ? w.requestIdleCallback(start, { timeout: 2500 }) : window.setTimeout(start, 1200);
    return () => { cancelled = true; if (w.requestIdleCallback && w.cancelIdleCallback) w.cancelIdleCallback(id as number); else window.clearTimeout(id as number); };
  }, [ready, get, setSize, invalidate]);

  useFrame(() => {
    const ph = phase.current;
    if (ph !== 'swapped' && ph !== 'restoring') return;
    const homeSize = home.current;
    if (!homeSize || flipUserFlipped()) { phase.current = 'done'; return; }
    const { width: w, height: h } = get().size;
    const stuck = performance.now() > deadline.current;
    if (ph === 'swapped') {
      const atSwapped = Math.abs(w - homeSize.h) < 1 && Math.abs(h - homeSize.w) < 1;
      if (atSwapped) ticks.current += 1;
      if ((atSwapped && ticks.current >= 2) || stuck) {
        phase.current = 'restoring';
        ticks.current = 0;
        deadline.current = performance.now() + 900;
        noteRehearsalSize(homeSize.w, homeSize.h);
        setSize(homeSize.w, homeSize.h);
      }
      invalidate();
      return;
    }
    const atHome = Math.abs(w - homeSize.w) < 1 && Math.abs(h - homeSize.h) < 1;
    if (atHome) ticks.current += 1;
    if ((atHome && ticks.current >= 2) || stuck) {
      phase.current = 'done';
      markRehearsed();
      releaseFlipHold();
      return;
    }
    invalidate();
  });
  return null;
}

/** Session memory of the horizontal safe-area fraction per orientation class
 *  (rotation round 3): the fan's landscape reserve reads this fraction, and a
 *  late env() commit after a flip used to shift the fan a beat after landing. */
const safeFracByClass = new Map<boolean, number>();

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
      const next = window.innerWidth > 0 ? inset / window.innerWidth : 0;
      safeFracByClass.set(isShortLandscape(window.innerWidth, window.innerHeight), next);
      setFrac(next);
    };
    const onFlip = () => {
      // Predict the target class's fraction from the session memory at the
      // flip signal itself; the probe reads on resize then verify (and
      // correct, if this device surprises us).
      const land = (window.screen?.orientation?.type ?? '').includes('landscape');
      const mem = safeFracByClass.get(land);
      if (typeof mem === 'number') setFrac(mem);
      read();
    };
    read();
    window.addEventListener('resize', read);
    window.addEventListener('orientationchange', onFlip);
    return () => { window.removeEventListener('resize', read); window.removeEventListener('orientationchange', onFlip); probe.remove(); };
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

/**
 * Reports when the canvas is really rendering: compiles the scene's shaders up front, then
 * fires on the second frame on the loop — by then the first frame, with its compile stalls,
 * has presented, so whatever the frame clock drives next (the intro deal) is on screen.
 * Fires once per mount; it never gates interactivity, only the deal intro's release.
 */
function FirstFrameSignal({ onFirstFrame }: { onFirstFrame?: () => void }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const frames = useRef(0);
  const fired = useRef(false);
  useEffect(() => {
    try { gl.compile(scene, camera); } catch { /* a failed warmup must never hold the deal */ }
    invalidate();
  }, [gl, scene, camera, invalidate]);
  useFrame(() => {
    if (fired.current) return;
    frames.current += 1;
    if (frames.current >= 2) { fired.current = true; onFirstFrame?.(); return; }
    invalidate(); // demand loop: make sure the confirming frame is scheduled
  });
  return null;
}

/** Test probe: the last hand spread/raise tween length in seconds (0 under reduced motion). */
function handSpreadProbe(s: number): number { if (typeof window !== 'undefined') (window as unknown as { __bwmSpreadS?: number }).__bwmSpreadS = s; return s; }
