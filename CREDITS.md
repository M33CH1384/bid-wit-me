# Credits & asset licenses — Bid Wit Me

All third-party art bundled in `apps/web/public/assets/` is CC0 (public domain). Files were downloaded
from the original sources and re-encoded/resized (1k + 512px JPEG) for the web; no other changes.

| File(s) | Asset | Author / source | License |
|---|---|---|---|
| `textures/scuba_suede_nor_gl_{1k,512}.jpg`, `textures/scuba_suede_rough_{1k,512}.jpg` | "Scuba Suede" fabric (felt normal + roughness) | Poly Haven — https://polyhaven.com/a/scuba_suede | CC0 1.0 |
| `textures/dark_wood_{diff,nor_gl,rough}_{1k,512}.jpg` | "Dark Wood" (table rail) | Poly Haven — https://polyhaven.com/a/dark_wood | CC0 1.0 |
| `hdri/billiard_hall_1k.hdr` | "Billiard Hall" HDRI (environment lighting) | Poly Haven — https://polyhaven.com/a/billiard_hall | CC0 1.0 |

CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/ (no attribution required; credited anyway).

## Fonts
- Barlow Condensed (600/700/800) by Jeremy Tribby, via `@fontsource/barlow-condensed` — SIL Open Font License 1.1.

## Generated / own assets
- Card faces, card backs, pips, court and Joker art: drawn procedurally at runtime (`apps/web/src/three/cardTextures.ts`).
- Table, rail, and card geometry: procedural (`apps/web/src/three/geometry.ts`).
- "BWM" wordmark (`assets/bwm-wordmark-white.svg`, variant D) and `favicon.svg`: Bid Wit Me brand assets (from `brand/variants/D`).

## Libraries
three.js (MIT), @react-three/fiber (MIT), @react-three/drei (MIT), React (MIT), Vite (MIT).
