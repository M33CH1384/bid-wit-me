# Vision Pro / VR spike — research note (NO code)

Status: **research only.** No build, no dependency. Decision input for Yoda/Demetrius.
Researched Oct 2026; sources cited inline. Our stack today: three 0.180, @react-three/fiber 9,
@react-three/drei 10, hand-rolled Web Audio engine + `spatial.ts` (#176).

## 1. Platform support (current)
- **Apple Vision Pro / Safari (visionOS):** WebXR `immersive-vr` is supported by default since
  visionOS 2 / Safari 18 — no flag. Input is gaze + pinch via the WebXR `transient-pointer` mode;
  `hand-tracking` is an optional session feature (permission prompt at session start).
  `immersive-ar` (passthrough) is NOT functional in Safari on visionOS — VR-only on the web.
  Sources: WebKit blog, "News from WWDC24: WebKit in Safari 18 beta"
  (https://webkit.org/blog/15443/news-from-wwdc24-webkit-in-safari-18-beta/); Apple WWDC24
  "Build immersive web experiences with WebXR" (https://developer.apple.com/videos/play/wwdc2024/10066/).
  Watch item: visionOS 26/27 adds the `<model>` element + `requestImmersive()` for USDZ-based
  environments (WWDC26 "Explore immersive website environments in visionOS") — a lighter-weight
  "preview the table" path than full WebXR, worth a separate mini-spike when it stabilises.
- **Meta Quest Browser:** mature WebXR (`immersive-vr` + `immersive-ar`), controllers and
  25-joint hand tracking via `getJointPose`/`fillPoses`. Source: Meta, "WebXR hands"
  (https://developers.meta.com/vr/documentation/web/webxr-hands/).
- **Desktop Chrome/Edge (PC-VR) and Android Chrome:** WebXR available; treat as compat targets only.
- **iPhone/iPad Safari:** no immersive WebXR. The phone stays the 2D game — any XR mode must be an
  optional enhancement entered from a supported headset browser, never a requirement.

## 2. Library choice: @react-three/xr vs raw WebXRManager
| | @react-three/xr (v6) | three WebXRManager (raw) |
|---|---|---|
| Fit | Built for R3F (our renderer); v6 adds controllers/hands/transient pointers by default, configured via `createXRStore` (e.g. `handTracking: true`); R3F pointer events keep working on meshes. | Lowest-level; we would hand-wire session, reference space, controllers (`getController`/`getControllerGrip`/`getHand`) into our existing non-XR scene lifecycle. |
| Vision Pro | Note the store default: handTracking is `false` on Apple Vision Pro in @react-three/xr (gaze+pinch transient pointer is the primary path) — enable explicitly per session. | Same platform limits, just more manual plumbing. |
| Cost | One new dependency (pmndrs, MIT). | No dep, most code. |

**Recommendation:** if we build, use **@react-three/xr v6** around the existing `<Canvas>` and keep
the non-XR game as the default path. Sources: pmndrs xr docs — migration from v5
(https://pmndrs.github.io/xr/docs/migration/from-react-three-xr-5), Store
(https://pmndrs.github.io/xr/docs/tutorials/store), Custom inputs
(https://pmndrs.github.io/xr/docs/tutorials/custom-inputs); three.js WebXRManager
(https://threejs.org/docs/pages/WebXRManager.html).

## 3. Input mapping (our gestures → XR)
| Current (touch/mouse) | Quest controllers | Quest hands | Vision Pro |
|---|---|---|---|
| Tap card (two-tap play) | Ray + trigger click on card mesh | Ray + pinch | Gaze (look at card) + pinch (`transient-pointer` select) |
| Drag card | Grab via grip space, move with controller, release over felt | Pinch-hold and move hand, release pinch | Pinch-hold is weak for long drags — prefer: pinch to pick up, gaze moves the card, pinch again to drop (two-pinch drag) |
| Sitting V-slam (up-then-down path) | Same path math on the controller ray/grip samples — our `dragSlamIntensity`/`isVGesture` already consume `{t,x,y}` samples; feed it projected controller samples unchanged | Same, from fingertip/palm samples; expect more jitter — raise the 24px leg threshold in world units | V while pinch-held, or a deliberate "raise hand then bring it down + pinch release"; must be tested for accidental triggers from natural pinch motion |
| Standing slam (always max) | Unchanged semantics: setting-driven, no gesture needed | Same | Same |
| PC triple-click slam | Map to a double-squeeze / trigger double-tap equivalent, or drop in XR (Standing already covers max-slam) | — | — |
| Menus/plates | DOM does not exist in XR: plates/menus need in-scene panels (see §5) | Same | Same |

## 4. Spatial audio alignment
Our Phase 2 groundwork transfers directly: in XR the `AudioListener` must follow the XR camera
(head pose) instead of `cameraFor` — `spatial.ts` already takes the camera pose as an input, so XR
mode passes the head pose each frame; seat panners (`seatPoint`) are world positions and work
unchanged at room scale. WebXR itself has no audio API — Web Audio remains the only path, and the
#169 impact-frame timing rule still applies (route through panners, never re-time triggers).

## 5. Reuse vs new
- **Reuse:** the whole R3F scene (table, cards, venues — 11 rooms from `venues.ts`), game state,
  deterministic play/slam fields, `spatial.ts`, bot/AI voices.
- **New:** (a) XR session shell + enter-VR button (secure context + user gesture required),
  (b) seating scale: our table is scene-units, not metres — pick a room scale (~1 unit = 0.35 m?)
  and a seated reference-space origin (`local-floor`) so the player sits AT the bottom seat;
  Sitting/Standing camera presets map naturally onto real seated/standing height,
  (c) in-scene UI panels for plates (BID/TOOK/YOUR TURN), bids, menus, chat — HTML overlays are
  invisible in-headset, (d) spectator mode: desktop/phone clients already spectate in 2D; an XR
  spectator is the same scene with a free camera, cheap once (a) exists.
- **Comfort/perf:** fixed seated viewpoint (no artificial locomotion → low sickness risk), keep
  the table within a comfortable ~60° arc, target 72–90 fps on Quest: our low-quality mode
  (no shadows/HDRI) is the XR baseline; cap pixel ratio; foveated rendering where the platform
  exposes it. Text (card indices, plates) must stay legible at headset resolution — likely needs
  slightly larger plate text in XR only.

## 6. Risks / unknowns to resolve before any build
1. Vision Pro has no controllers: every interaction must work with gaze+pinch alone first;
   Quest-first design would strand our headline platform.
2. Hand-tracking precision for card drags (small targets) — may need magnetic snapping to legal cards.
3. Session UX: entering XR from the 2D lobby mid-game (seat continuity, WebRTC voice — the
   existing `online/video.ts` mesh is camera/mic for 2D; in-headset voice should be plain WebRTC
   audio, spatialised per §4).
4. Cost: this is a new client surface (input, UI panels, QA on two headsets). Estimate only after
   a one-scene throwaway prototype (enter VR, sit at table, pinch-play one card) — proposed as
   the gate for any real build decision. No estimate given here on purpose.

## 7. Bottom line
Feasible with our existing scene and spatial plumbing; @react-three/xr v6 is the right wrapper;
Vision Pro means gaze+pinch-first design and VR-only (no passthrough AR on the web). Recommend:
no build now; if Demetrius wants it, fund the tiny prototype in §6.4 as its own spike PR with a
go/no-go note.
