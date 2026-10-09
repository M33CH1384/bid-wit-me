# Credits & asset licenses — Bid Wit Me

All third-party art bundled in `apps/web/public/assets/` is CC0 (public domain). Files were downloaded
from the original sources and re-encoded/resized (1k + 512px JPEG) for the web; no other changes.

| File(s) | Asset | Author / source | License |
|---|---|---|---|
| `textures/scuba_suede_nor_gl_{1k,512}.jpg`, `textures/scuba_suede_rough_{1k,512}.jpg` | "Scuba Suede" fabric (felt normal + roughness) | Poly Haven — https://polyhaven.com/a/scuba_suede | CC0 1.0 |
| `textures/dark_wood_{diff,nor_gl,rough}_{1k,512}.jpg` | "Dark Wood" (table rail) | Poly Haven — https://polyhaven.com/a/dark_wood | CC0 1.0 |
| `hdri/billiard_hall_1k.hdr` | "Billiard Hall" HDRI (environment lighting) | Poly Haven — https://polyhaven.com/a/billiard_hall | CC0 1.0 |

CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/ (no attribution required; credited anyway).

## Sound
| File(s) in `apps/web/public/assets/sfx/` | Source | License |
|---|---|---|
| `shuffle.mp3` (card-shuffle), `deal-1..3.mp3` (card-slide-1..3), `play-1..3.mp3` (card-place-1..3), `sweep-1..2.mp3` (card-shove-1..2), `bid.mp3` (chip-lay-1) | Kenney "Casino Audio" 1.1 — https://kenney.nl/assets/casino-audio | CC0 1.0 |
| `tap.mp3` (click3), `pop.mp3` (rollover2) | Kenney "UI Audio" — https://kenney.nl/assets/ui-audio | CC0 1.0 |

Re-encoded from OGG to mono 64 kbps MP3 (plays on iOS Safari). The your-turn chime, cut/trump hit, spades-broken sting,
whoosh, BID MADE / SET! / NIL! / BAG PENALTY stingers, win/lose jingles and the optional lounge ambience are
synthesized at runtime with Web Audio (`apps/web/src/audio.ts`) — no files.

## Music (`apps/web/public/audio/music/`, shuffled playlist, off by default)
| File | Track | Artist / source | License |
|---|---|---|---|
| `windows-down.mp3` | Windows Down | Holizna — https://opengameart.org/content/lo-fi-and-chill-collection | CC0 1.0 |
| `coins.mp3` | Coins | Holizna — https://opengameart.org/content/gamer-beats-collection | CC0 1.0 |
| `final-level.mp3` | Final Level | Holizna — https://opengameart.org/content/gamer-beats-collection | CC0 1.0 |
| `2-hour-delay.mp3` | 2 Hour Delay | Holizna — https://opengameart.org/content/lo-fi-and-chill-collection | CC0 1.0 |
| `chillin-hard.mp3` | Chillin Hard | Kevin MacLeod — https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1600028 | CC BY 4.0 |

Required attribution for track 5 (also shown on the in-game Credits screen):

"Chillin Hard" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/

Changes: re-encoded to 128 kbps stereo MP3 (44.1 kHz), metadata/cover art stripped. At playback a gentle
mid/side stereo widening (side boosted above 150 Hz with a slow width LFO; mono sum unchanged) and 4 s crossfades are applied.

## Fonts
- Barlow Condensed (600/700/800) by Jeremy Tribby, via `@fontsource/barlow-condensed` — SIL Open Font License 1.1.

## Generated / own assets
- Card faces, card backs, pips, court and Joker art: drawn procedurally at runtime (`apps/web/src/three/cardTextures.ts`).
- Table, rail, and card geometry: procedural (`apps/web/src/three/geometry.ts`).
- "BWM" wordmark (`assets/bwm-wordmark-white.svg`, variant D) and `favicon.svg`: Bid Wit Me brand assets (from `brand/variants/D`).

## Libraries
three.js (MIT), @react-three/fiber (MIT), @react-three/drei (MIT), React (MIT), Vite (MIT).
