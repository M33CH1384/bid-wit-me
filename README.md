# Bid Wit Me — Spades (Phase 1)

Rules engine, bots, and a 3D (three.js) web table for Joker Spades 2v2, Cutthroat (3 or 4 players, Joker or standard deck), and Ace Down.
The full plan is in [SPEC.md](SPEC.md).

## Layout

```
packages/rules   pure, deterministic rules engine (seeded shuffle, deal, bids, legality, tricks, scoring, game end)
packages/bots    heuristic bots (Easy / Normal) that only see their own seat's view
apps/web         Vite + React + @react-three/fiber 3D table (streamer-overlay HUD): one human (seat 0) vs bots
scripts/         simulate.ts (headless bot-vs-bot games), e2e.mjs (headless Chrome UI run), shots3d.mjs (phone + desktop 3D screenshots)
```

## Commands

```bash
pnpm install
pnpm test               # vitest: rules + bots (unit, property-based, golden)
pnpm test:coverage
pnpm typecheck
pnpm simulate 50        # 50 bot-vs-bot games per mode with invariant checks
pnpm dev                # dev server on http://localhost:5173
pnpm build && pnpm preview   # production build served on http://localhost:4173
node scripts/e2e.mjs    # plays full games through the UI in headless Chrome w/ SwiftShader WebGL (needs preview running)
node scripts/shots3d.mjs  # screenshots/3d/{phone,desktop}-{1-start,2-bidding,3-mid-trick}.png
```

## Default rules (from SPEC.md + Demetrius's decisions)

- **Joker Spades 2v2:** 2♣ and 2♥ removed. Trumps from highest: Big Joker › Little Joker › 2♦ › 2♠ › A♠ … 3♠.
  The 2♦ counts as a spade (diamonds have no 2). The classic order (2♥ 2♦ removed, BJ › LJ › A♠ … 2♠) is a house-rule option.
- **Cutthroat:** each player for themselves, target 300. The host picks the **Joker deck (default, same trump order)** or a **standard 52**.
  3-player games deal 17 each: Joker deck removes 2♣ 2♥ 3♣, standard deck removes 2♣.
- **Ace Down:** standard 52, no jokers, aces highest, regular Spades bidding and scoring, 2v2.
- Everyone: spades must be broken, Nil ±100, Blind Nil ±200 (only when behind by 100+), bags 10 = −100, target 500, losing floor −200.
  All are configurable via `makeRules(mode, overrides)` and the House rules panel.

## 3D table

- `apps/web/src/three/`: `Scene.tsx` (lazy-loaded Canvas, lights, HDRI, table, cards, seat plates), `Card3D.tsx`
  (rounded card boxes with PBR card stock + tweened arc animations), `cardTextures.ts` (procedural faces/backs),
  `geometry.ts`, `layout.ts` (seat/fan/trick/pile transforms and portrait↔landscape camera).
- The rules/bots/game-state flow is unchanged; the scene is a pure view of `useGame` state.
- Graphics setting: **High** (soft shadows, HDRI, 1k textures, DPR ≤ 1.75, MSAA) / **Low** (no shadows/HDRI, 512 textures, DPR 1).
  Toggle in setup or with the HQ/LQ button in the scorebug.
- Accessibility/automation: a visually hidden button list (`data-testid="card-XX"`, `data-legal`) mirrors the 3D hand.
- Asset licenses: see `CREDITS.md` (Poly Haven CC0 textures + HDRI).

## Sound & music

- `apps/web/src/audio.ts`: Web Audio engine, unlocked on the first tap (iOS). Kenney CC0 card/chip samples
  (`public/assets/sfx/*.mp3`) + synthesized cues: your-turn chime, cut/trump hit, spades-broken sting (bigger; wins
  when both apply), trick-sweep whoosh, BID MADE / SET! / NIL! / BAG PENALTY stingers, win/lose jingles, optional lounge ambience.
- Music: 5-track shuffled playlist (`public/audio/music/*.mp3`, 128 kbps), off by default, lazy-loaded with one-track
  look-ahead, 4 s crossfades, gentle mono-compatible mid/side widening, "Now playing" ticker.
- Controls: setup screen + speaker button in the scorebug (SFX on/off + volume, ambience, music on/off + volume), persisted
  in localStorage (`bwm.sound.v1`). The iPhone silent switch mutes Web Audio.
- Credits & licenses: `CREDITS.md` and the in-game Credits screen (includes the CC BY 4.0 line for "Chillin Hard").

## Release 3 features

- **First hand: books bid themselves** (house rule, on by default, toggle in setup / online lobby): hand 1 has no
  bidding; every book is worth 10, no bags, no penalties, no Nil. Engine: `packages/rules` (`'books'` bids), bots
  take every trick they can that hand.
- **Tips beyond hand 1 + bid coach**: tips stay on until "I've got it — tips off"; each tip shows up to 3 times,
  then only on "?" (help). The bid coach (in the bid panel) counts sure winners, spade length, cuts, partner and Nil
  suitability with the same estimate the bots use (`analyzeHand` / `bidAdvice` in `packages/bots`).
- **Learning mode**: with tips on, offline games run at *Slow* and an open tip holds the bots and the trick sweep;
  online, that player's own turn timers are ×1.5 (`learning` message). Tips off → back to the chosen speed.
- **Hype effects** (`fx.ts`, `Hype.tsx`, synthesized SFX in `audio.ts`): streak pop-ups (HEAT CHECK / ON FIRE /
  UNSTOPPABLE), SHOT! / GOT SHOT, joker rumbles with camera shake + table vibration, Big-over-Little nuke. Derived
  from game state on every client, so online everyone sees them. "Reduce effects" (sound popover / gear sheet, also
  `prefers-reduced-motion`) keeps sounds + text and drops shake / flash / shockwave.
- **Table Talk** between hands (online + offline): recap per team (books/bid, made/set, Nil badges, bags), totals with
  progress to the target, callouts, 2×2 cam grid (avatars when the camera is off), chat with quick reactions, a deal
  mini-view, countdown (host: 15/20/30/45 s, default 20) and Ready / Continue. Offline: bot banter.
- **Voice anti-cheat** (online): during bidding and trick play **partners only** can't hear each other — my mic
  track isn't sent to my partner's peer connection (send-side `replaceTrack(null)`) and their voice isn't played here
  (receive-side). Opponents still hear everyone (trash talk is part of the game). All mics are open in the lobby,
  during Table Talk and after the game. A "MIC LIMITED" badge shows while it applies; a "Table talk over — partners
  muted" toast marks the switch back.
- **Host music** (online, sound popover): (a) one of the 5 built-in beats, synced by a server-stamped start time;
  (b) a Spotify / Apple Music link shown as a tappable card for everyone (only those hosts are accepted);
  (c) the host streams tab/device audio (`getDisplayMedia`, desktop) or a local audio file over the WebRTC mesh on a
  separate audio transceiver (so partner muting never cuts the music), with a rights disclaimer. Every player has
  their own "Host music volume"; personal music pauses while host music plays.
