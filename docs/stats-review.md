# Stats review

Approved work for Bid Wit Me stats. Phase 1 is a set of small, independently mergeable changes. Phase 2 starts only after those pull requests are merged.

Rules that stay in place: Elo and Best duos count signed-in opponents only. A guest does not make a game rated. Wins against guests count toward neither vs players nor vs bots. Bid accuracy counts every completed signed-in game, including games vs bots.

## Bags check (item f)

`scoreHand` in `packages/rules/src/scoring.ts` is the in-game rule. `bagsAdded` is not “overtricks on a made contract” only:

- A made contract adds one bag per overtrick.
- A failed nil’s tricks are bags by default, including when the side is set (`contractMade === false`). The nil-scoring test covers this: bid nil, take 2, partner misses, `bagsAdded === 2`.
- With no contract, tricks that are not book points are bags.
- A books hand adds no bags. With “Bags and penalties” off, `bagsAdded` is forced to 0.

`buildRecord` in `apps/server/src/stats/record.ts` only adds `bagsAdded` when `contractMade === true` and this seat bid a number. That drops bags from a set that still scored bags (busted nil) and from a hand with no contract. It is a bug. The fix is to add `bagsAdded` once per hand, which stays 0 for books hands and when bags are off, matching the score pad.

## Phase 1

Each item is its own pull request and can merge on its own.

### (a) Finished offline games

At `gameOver`, `useGame.ts` POSTs `/api/stats/local` for a signed-in player. The server rebuilds the record with `buildRecord`. Bots are `kind: 'bot'`. The row is stored `rated = 0`, `source = 'offline'`. The client game id is the idempotency key. The server checks a plausible hand count, a duration that fits the history, and scores that match the history. A per-user rate limit applies. A `localStorage` queue retries on reconnect. A D1 migration adds the new columns.

### (b) Backfill the Homies win

Backfill the offline 2v2 Joker win (296–192, team name Homies, user M33CH, id `ed41194162a842d61600fdf573d9a9d5`) from the `progress` import as an offline `partial = 1` record. Do it as an idempotent D1 migration or a server-side one-shot that reads `progress`, so it runs through the normal deploy. Safe to run twice.

### (c) Games that end early

Record online games that end early — leave (`room.ts` leave), restart / new game (`room.ts` `startGame`), and room expiry — with `end_reason = 'abandoned'`. If the game is rated, count it as a loss for the leaver. Count it in games started for everyone. Never count it as a win.

### (d) Seat link retry

`accountTicket()` in `store.ts` falls back to guest after 1.5s. Retry on a timer. When a signed-in user’s seat is not linked, show a “Stats off, tap to reconnect” chip.

### (e) Site header

Relabel the server-wide “1 games (1 today)” header to “Site: N games today”.

### (f) Bags on every hand

Count bags on every hand, not only made contracts, consistent with in-game scoring (see the bags check above).

Add tests for each item. Typecheck and the full suite stay green. Attach 390px screenshots where there is UI.

## Phase 2

Only after the Phase 1 pull requests are merged.

A richer per-mode Your stats card: games, W-L, win% vs players and vs bots (offline counts as vs bots), bid accuracy, set rate, nils made/tried, bags/hand, books/hand, shots, and rating or “Unrated”. Add the current streak, last-10 result dots, and a post-game summary with rating and accuracy deltas. Store compact per-hand history JSON. Elo and Best duos still count signed-in opponents only.
