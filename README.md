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
  4-player: all cards (52 after the Joker deck's 2♣ 2♥), 13 each, 13 books. 3-player: 17 each, 17 books, by removing
  the lowest NON-TRUMP cards, fixed and shown in the setup summary + glossary (never a spade, joker or promoted 2♦):
  standard deck removes the 2♣; Joker deck (54) removes 2♣, 2♥, 3♣.
  No teams: bids, scoring, bags and Shot = out are per player (first-hand minimum off). Bids go clockwise from the
  dealer's left. Host / offline settings, locked once the game starts: target 300 (default) / 500 / 250, minimum bid
  1–4 (default 1), Allow Nil (on), Allow Blind Nil (off), Bags and penalties (on; off = books over your bid score
  nothing). A bid of 0 is always Nil (Nil scoring); with Nil off, 0 can't be picked. Bots follow the same options.
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

## Release 6: bidding order, partner talk, score pad

- **Bidding order (team games):** the team WITHOUT the deal bids first, both partners back to back, then the dealer's
  team: the dealer's partner, and the dealer last. Seats clockwise D, L, P, R → bids L, R, P, D. Play order is
  unchanged (dealer's left leads the first trick, clockwise). Cutthroat bids clockwise from the dealer's left. Engine:
  `bidOrder` / `nextBidder` in `packages/rules` (server-authoritative); the table shows a BID ORDER strip.
- **Partner talk during bidding:** partners can talk out loud about books during bidding; all chat is public. Partner
  mics are open while bidding (the host's partner mic mute applies only during trick play), and every typed line goes to
  the whole table, opponents included; there is no private partner channel. (Release 9 removed the 🤝 Partner talk
  preset panel and bot partners' typed hints: partners talk out loud over open mics; each player bids their own number.)

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
- **Voice anti-cheat** (online, **host option, off by default**): the host turns on "Partner mic mute" in the lobby's
  table settings (`config.partnerMicMute`, validated as a boolean, host-only, lobby-only; everyone sees the choice in
  the lobby). When it's on, during **trick play only** (from the first card led to the end of the hand) **partners only** can't hear each other — my mic
  track isn't sent to my partner's peer connection (send-side `replaceTrack(null)`) and their voice isn't played here
  (receive-side). Opponents still hear everyone (trash talk is part of the game). All mics are open in the lobby,
  **during bidding** (partners may talk books, vaguely, to agree on a total; each still bids their own number), during
  Table Talk and after the game. A "MIC LIMITED" badge shows while it applies; a "First card's down — partner mics
  muted" toast fires when the first card is led. When it's off (the default) nobody is limited, and there's no badge or
  partner-muting toast.
- **Random bot names**: bots get names at random per game from a pool of 80 (`packages/bots/src/names.ts`): never two
  alike at a table, never a human player's name. Offline they're derived from the game seed and kept in the save
  (stable across refresh / resume); online the server picks them for bot seats, leavers, kicks and AFK replacements, so
  every client sees the same names. Plate / chat colours follow the seat, not the name.
- **Host music** (online, sound popover): (a) one of the 5 built-in beats, synced by a server-stamped start time;
  (b) a Spotify / Apple Music link shown as a tappable card for everyone (only those hosts are accepted);
  (c) the host streams tab/device audio (`getDisplayMedia`, desktop) or a local audio file over the WebRTC mesh on a
  separate audio transceiver (so partner muting never cuts the music), with a rights disclaimer. Every player has
  their own "Host music volume"; personal music pauses while host music plays.

### Nuke v2, team names, rematch series, bot trash talk
- **Nuke (Big Joker over Little Joker)**: cinematic R3F effect (`apps/web/src/three/Nuke3D.tsx`): pin-point → white-out flash with bloom, noise-shader fireball → mushroom cloud (stem + rolling cap), shockwave ring, dust skirt, cards blown out and settling, camera punch-in + shake, chromatic aberration + vignette, embers/ash; layered audio (sub boom, delayed crack, rumble tail, tinnitus ring that ducks music/SFX). **Nuke intensity is a table setting** (Full Nuke / Classic / Off): host picks it in the lobby online (server-validated), More options offline; *Reduce effects* still forces the calm version locally. Capture: `node scripts/nuke-shots.mjs [web] [fps]` (frame-exact via `fx.warp`).
- **Team names** (team modes): either partner edits their team's name in the lobby or Table Talk (server-validated: 20 chars, emoji ok, filtered; changes announced in chat). Offline: More options → Your team name; bot teams get a random fun name. Default = partner names.
- **Rematch series**: running tally per team/player across rematches (`packages/rules/src/series.ts`, a JSON record with member ids + per-game results for future stats). Online it lives on the table (survives reconnects; resets with a note when the team composition changes; keyed on members, not names). Offline it's in localStorage and resets when a new game starts from the menu. Shown as `SERIES 3–1` in the scorebug, Victory and Table Talk; tap for every game + hand-by-hand totals.
- **Bot trash talk**: personas in one data file (`packages/bots/src/personas.ts`: The Professor, Big Mama, The Hype Man, The Petty One, The OG, The Hustler, Silent Assassin), fixed per bot name. Engine (`talk.ts`) with cooldowns, pre-play lines that never see the card, Hustler reveal (once, `HUSTLED!` pop), persona bid lean. Online the server speaks for bots (host toggle, default on); offline toggle in More options. Per-player: Bot voices (recorded clips, see below; default on) + volume, Hide bot trash talk, Clean talk (masks mild cursing; default on), quick mute in the sound dock.

### Last-trick nuke, Run it!, recorded bot voices

- **Last-trick nuke** (Joker mode): when both Jokers fall in one trick (either order), the nuke fires and everyone still to play auto-plays their lowest legal card (server-authoritative; `☢ Nuked — remaining cards auto-played`). A Joker on the table does not pulse. Other tricks: unchanged.
- **Run it! 🌪**: on lead with 2–4 cards, the engine proves by exact minimax (`canRunIt` / `guaranteedLead` in `packages/rules/src/game.ts`) that you take every remaining book whatever anyone plays; only then the button shows. Tap: your cards slam down, a tornado rips every hand (yours, partner's, opponents') and the table into the funnel and flings it away (`Tornado3D.tsx`, Card3D `applyTornado`), `RAN IT!` banner, wind + whooshes, camera sway, tap to skip; Reduce effects = a plain slide away. The remaining tricks are recorded as played in the solver's order (scoring/stats identical to playing it out). Bots run it 65% of the time when guaranteed. First appearance: a spotlight tip (even with tips off, up to 3 times); first use: Storm Chaser badge (`bwm.badges.v1` `{v, badges:[{id, earnedAt, context}]}`; online also on the room's member record), listed under More options → Badges and on your plate. Capture: `node scripts/runit-shots.mjs`; spot builder: `npx tsx scripts/runit-state.ts`.
- **Recorded bot voices**: Kokoro-82M clips (Apache-2.0) in `apps/web/public/voices/<persona>/<lineId>.(webm|m4a)`, mapped by `apps/web/src/voices/manifest.json` (persona → raw line → clip; regenerate it with `node scripts/voices-manifest.mjs`). Bot lines carry a line id (`<pool>.<kind>.<index>`, also sent by the server); the client resolves it to the raw line and plays its clip through Web Audio (Opus/WebM, AAC/M4A on Safari), ducked under the nuke / tornado / Wheels / other big stingers. A persona's clips preload when its bot sits down. Lines without a clip (the 8 Run it! lines, added after recording) use Web Speech. Clean talk picks the clean take where one exists.
