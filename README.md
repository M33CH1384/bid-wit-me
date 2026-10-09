# Bid Wit Me — Spades (Phase 1)

Rules engine, bots, and a 2D web table for Joker Spades 2v2, Cutthroat (3 or 4 players, Joker or standard deck), and Ace Down.
The full plan is in [SPEC.md](SPEC.md).

## Layout

```
packages/rules   pure, deterministic rules engine (seeded shuffle, deal, bids, legality, tricks, scoring, game end)
packages/bots    heuristic bots (Easy / Normal) that only see their own seat's view
apps/web         Vite + React 2D table: one human (seat 0) vs bots
scripts/         simulate.ts (headless bot-vs-bot games), e2e.mjs (headless Chrome UI run)
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
node scripts/e2e.mjs    # plays full games through the UI in headless Chrome (needs preview running)
```

## Default rules (from SPEC.md + Demetrius's decisions)

- **Joker Spades 2v2:** 2♣ and 2♥ removed. Trumps from highest: Big Joker › Little Joker › 2♦ › 2♠ › A♠ … 3♠.
  The 2♦ counts as a spade (diamonds have no 2). The classic order (2♥ 2♦ removed, BJ › LJ › A♠ … 2♠) is a house-rule option.
- **Cutthroat:** each player for themselves, target 300. The host picks the **Joker deck (default, same trump order)** or a **standard 52**.
  3-player games deal 17 each: Joker deck removes 2♣ 2♥ 3♣, standard deck removes 2♣.
- **Ace Down:** standard 52, no jokers, aces highest, regular Spades bidding and scoring, 2v2.
- Everyone: spades must be broken, Nil ±100, Blind Nil ±200 (only when behind by 100+), bags 10 = −100, target 500, losing floor −200.
  All are configurable via `makeRules(mode, overrides)` and the House rules panel.
