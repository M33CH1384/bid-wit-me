# Immersive 3D Spatial Audio — Phase 1 audit & plan

Status: **Phase 1 only (audit + plan). No implementation.** Yoda reviews this plan before Phase 2.
Scope rule for all phases: small reviewable PRs, no paid APIs, no new secrets, prefer existing deps.

## 1. What exists today (audit, Oct 2026)

### Sound engine — `apps/web/src/audio.ts`
- One hand-rolled Web Audio `Engine` (singleton `sound`), created lazily on first user gesture
  (`installUnlock` on `touchend`/`pointerup`/`click`; `AudioContext.resume()` retries — iOS requirement).
- Buses (all `GainNode`s into a master gain): **sfx**, **music** (two `<audio>` decks, single-flight
  crossfade — #170), **ambience/venue bed** (`setVenueBed`/`syncVenue`, `VenueBed` ids:
  `cookout`, `mansion`, `barbershop`, `basement`, `rooftop`, `jazz`, `casino`, `beach`, `kitchen`,
  `yacht`, `none`), **nuke**, **voice** (bot speech: WebAudio buffer + Web Speech fallback).
- Landing sounds are fired on the visual impact frame (`landCue` in `Card3D.tsx`, `landTiming.ts`;
  #169 asserts sound vs landing within ~50 ms) and scale with slam intensity (`cardSmack`, `slam.ts`).
  **Any spatial work must preserve that timing contract** — panners sit downstream of the trigger.
- Persisted settings (`bwm.sound.v1`, `settings.ts`): on/off, master volume, ambient on/off,
  music on/off + volume, venue sound on/off. Game-scope silencing on Home / suspend / quit is
  centralised in `gameSession.ts` (#161) — spatial nodes must hang off the same buses so Home stays silent.
- Card/physical sounds today are mono samples + synthesized thumps (`three/shake.ts` `PILE_THUMP`,
  vertical-only camera thump, #158/#169). No `PannerNode`, `StereoPannerNode`, or drei
  `PositionalAudio` anywhere in `apps/web/src` yet.

### 3D scene & seating — `apps/web/src/three/`
- three `0.180`, `@react-three/fiber` 9, `@react-three/drei` 10 (already a dependency),
  `@react-three/postprocessing`. No Howler, no Resonance Audio.
- Seat geometry is deterministic: `seatDir(pos, n)` in `three/layout.ts` gives each seat a unit
  direction from table centre (human `bottom` = +Z toward camera, `top`, `left`, `right`; 3-player
  variants included). Trick spots / landed positions come from the same layout module, so a sound's
  3D position can reuse the exact vector the card mesh lands at — no new coordinate system.
- Camera: `cameraFor(aspect, short)` (portrait phone pos ≈ `[0, 4.5, 3.75]`, looking at felt centre).
  A Web Audio `AudioListener` can be slaved to this each frame (or set once per aspect change;
  the camera is mostly static during play).
- The human's seat is always `bottom` (viewer-relative). Opponents' plays already carry seat +
  optional slam intensity (protocol `Play.slam`, `Play.rel`) so remote clients render identical
  slams — the same fields can drive identical spatial placement.

### Voice
- **Bot/AI voices (offline + online bots):** canned Web Speech today; Kokoro-82M AI clips are
  Phase 3 of the voice programme (#164 client playback with canned fallback, #167 bake pipeline,
  `packages/bots/src/catalog.ts`, clips under `apps/web/public/voices/ai`). Playback goes through
  the engine's voice path (`speakBot`/`deliverBotLine`) — the natural single place to spatialise.
- **Human voice chat already exists** — not LiveKit: a WebRTC peer mesh in
  `apps/web/src/online/video.ts`, signalling relayed through the table Durable Object
  (`{t:'rtc'}`), getUserMedia only from a tap, partner-mic anti-cheat muting during trick play
  (`OnlineTable.tsx`). Remote streams are plain `MediaStream`s played via audio elements.
  Spatialising them = `MediaStreamAudioSourceNode` → panner → voice bus (Phase 7 decision point:
  reuse this mesh; do **not** add LiveKit — no new service/secrets needed).
- Talk/queue logic (`packages/bots/src/talk.ts`, `talkPrefs.ts`) already prioritises and de-dupes
  lines per persona; a spatial voice queue can reuse its ordering.

### Venues / soundscapes
- 11 venues (`packages/protocol` `VENUES`, `apps/web/src/venues.ts` `VENUE_DEFS`) already map to
  ambience beds (`bed: BedId`). The four requested soundscapes largely exist as venues:
  Backyard Cookout → `backyard`/`cookout` bed; Barbershop → `barbershop`; Basement Spades Night →
  `church` (Church Basement, bed `basement`) — a dedicated "Basement Spades Night" bed variant is a
  content task, not an engine task. **Competitive Tournament has no venue/bed yet** (new bed id +
  CC0 crowd/arena loop). Soundscape = venue bed + crowd layer + music mood, crossfaded on venue change.

### iPhone Safari constraints (hard requirements)
- AudioContext unlock only from a user gesture; remote WebRTC audio starts muted until first tap
  (`video.ts` `needsTap`). Spatial graph must be built/resumed inside the same unlock path.
- `PannerNode` with `panningModel: 'HRTF'` costs CPU per node. On a 390px iPhone we cap concurrent
  spatialised one-shots (≤ ~8), prefer `'equalpower'` fallback, and keep beds/music on plain
  stereo. HRTF support: Safari supports `PannerNode` (HRTF included) — verify per-phase on device.
- No background audio when not on the table (#161 guard is the enforcement point).
- `webkitAudioContext` prefix handled by the existing engine; new nodes must use the same context.

## 2. Proposed architecture

```
                 ┌─ music bus (existing 2-deck crossfade) ─┐
 master gain ────┤                                          ├─ destination
 (persisted vol) ├─ ambience bus (venue bed + crowd layer) ─┤
                 ├─ sfx bus ──► per-event panner ───────────┤
                 ├─ voice bus ─► per-seat panner ───────────┤
                 └─ nuke bus (existing) ────────────────────┘
```

- **One central engine stays** (`audio.ts`). Add a thin `spatial.ts`: listener pose from
  `cameraFor`, `seatPosition(seat)` from `seatDir`, and `playAt(sample, seat|point, opts)` /
  `voiceAt(seat)` helpers that insert a `PannerNode` (HRTF, `distanceModel: 'inverse'`,
  tuned `refDistance`/`rolloffFactor`) between the existing source and the existing bus.
  Nothing else changes call sites' timing: triggers remain impact-frame-accurate.
- **Categories & persisted volumes** (independent, `bwm.sound.v1` gains fields with defaults):
  master, music, ambience, SFX, player voices (WebRTC), AI voices (bots), crowd (layer under
  ambience but separately mutable). Migration: missing fields = current defaults; unit-tested.
- **Event-driven gameplay SFX:** plays/slams/collects/deals emit `(seat, intensity, card)` events;
  sample choice picks from small per-event variant sets with a no-repeat rule (don't replay the
  same variant twice in a row per event type) and intensity-scaled gain/playbackRate (already the
  `cardSmack` model — extend, don't replace).
- **Fallbacks:** `spatial: on/off` setting (default on, auto-off when HRTF missing or when
  `prefers-reduced-motion`-adjacent low-power heuristics fail); with spatial off, sources connect
  straight to the bus as today (stereo). Human seat sounds stay near-centre (slight in-front
  placement) so your own plays never feel detached.
- **AI/bot voices from seat:** route `speakBot` output through the speaker's seat panner, with the
  existing talk queue priorities (moment lines > chatter) and a max of one voice at a time.
- **Human voice chat:** optional per-peer panner keyed to that peer's seat; partner anti-cheat
  muting unchanged. Off with the spatial setting.
- **Music note (supersedes queue item 12's music half):** keep the shipped single-flight
  crossfade engine; later phases can layer tension stems (extra deck whose gain follows
  score/hand tension) behind the `musicNote` approach — no engine swap, no Howler.

## 3. Library evaluation
| Option | Verdict |
|---|---|
| Plain Web Audio `PannerNode` | **Recommended.** Zero deps, full control of timing, Safari-supported, fits the existing engine. |
| drei `PositionalAudio` | Reuse-friendly (drei already installed) but ties sound lifetime to R3F components; our triggers live in the engine/Table layer. Use only if a Phase needs in-scene emitters. |
| Howler.js | Redundant second engine; would fight the existing unlock/buses. Reject. |
| Google Resonance Audio | Heavier, room-modelling we don't need for a card table; extra dep + WASM. Reject for now. |

## 4. Phase plan (each = one small PR, Yoda merges; stop after each for approval)
1. **This audit + plan** (docs only).
2. Engine: category gains + persisted volumes + `spatial.ts` scaffolding (listener + seat panners,
   spatial off = today's graph). Unit tests for graph routing/settings migration.
3. Gameplay SFX spatialised (plays/slams/collects from seat/landing point; variant/no-dup rules).
   E2E: probe asserting panner position per seat; sound-sync test (#169) still passes.
4. Soundscapes: crowd layer + crossfades on venue change; new Competitive Tournament bed
   (CC0/commercial-use asset, documented in `docs/asset-licenses.md`); soundscape follows venue.
5. AI/bot voices from seat + voice queue priorities on the spatial voice bus.
6. Music tension layers on the existing crossfade decks (menu↔table transitions preserved).
7. Human WebRTC voice chat spatial placement (reuse `video.ts` mesh; no LiveKit).
8. Mobile/perf pass: HRTF node caps, equalpower fallback, iPhone device check, spatial-off
   auto-detection; final settings UI (category sliders + spatial toggle).

Asset rule for every phase: CC0 or clear commercial-use licence only, each asset logged with
source + licence in `docs/asset-licenses.md` before it ships.

## 4b. Amendments (Yoda review, Oct 2026 — required before Phase 2)

1. **Audio-quality setting** (`Low / Balanced / High`, persisted, default Balanced): controls
   codec/bitrate choices for streamed music + ambience (e.g. Low = 64–96 kbps mono-ish baked mixes,
   Balanced = 128 kbps stereo, High = 192 kbps+ / lossless-leaning baked mixes), how many HRTF
   panners may run concurrently (Low 4 / Balanced 8 / High 12), and whether crowd/soundscape layers
   are full stems or a single baked loop. iOS perf rule: quality auto-drops a tier when the device
   reports low memory/cores (same heuristic as the existing graphics `defaultQuality()`), and the
   user can always override. Baked assets ship per-tier files only where the difference is audible.
2. **Per-player mute controls:** every human/bot seat gets a local mute for that player's
   voice/chat audio (tap a plate → mute voice; persisted per player id for the session, local only —
   never signalled). Muting a voice must not mute that seat's card SFX. Bots' AI voices share the
   same per-seat control. This lands with Phase 5/7 plumbing but the setting shape is defined now:
   `mutedVoices: Record<playerId, true>`.
3. **Separate environment picker:** soundscape is NOT hard-bundled to the visual venue. A new
   persisted `soundscape` setting (`Auto` = follow venue as today, or any soundscape id:
   Backyard Cookout, Basement Spades Night, Barbershop, Competitive Tournament, plus the existing
   bed ids) overrides the venue bed/crowd/music-mood independently of the 3D theme. `Auto` keeps
   current behaviour exactly; the venue picker never changes audio unless soundscape is `Auto`.
4. **Story Mode per-stop soundscapes:** Story Mode stops each declare a soundscape mapping
   (stop id → soundscape id) in their stop data; entering a stop applies that soundscape (unless the
   user has locked a manual soundscape, which wins and is announced in the picker). This is
   plumbing-level in Phase 2 (the resolver `soundscapeFor({venue, setting, storyStop})`), with
   per-stop content filled in as Story stops ship.
5. **Phase 6 music tension layers are GATED:** do not build tension layers/stems until Demetrius
   approves the richer-music pitch note (separate short doc + his explicit go-ahead). The plan's
   Phase 6 stays on paper; Phases 2–5 and 7–8 may proceed around it.

## 5. Risks / open questions for Yoda
- HRTF CPU on older iPhones — Phase 8 may default spatial to `equalpower` on phones.
- Voice chat panning vs intelligibility: keep partner gain compensation so panning never buries speech.
- Tournament soundscape asset sourcing (CC0 arena/crowd loops) may need Demetrius to approve a specific source.
