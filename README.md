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
