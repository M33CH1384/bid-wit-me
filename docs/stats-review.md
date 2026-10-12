# Stats review (read-only, origin/master b086e28, 2026-10-12)

## 1. Diagnosis: what D1 holds
- `users`: one account, M33CH (`ed41194162a842d61600fdf573d9a9d5`).
- `games`: 1 row server-wide: `MEZBY-mv4v3eiz-1`, online Cutthroat vs 3 bots, 3 hands, rated=0, he won.
- `game_players`: 1 row. `ratings`: empty.
- `progress`: his one-time "Save my progress" import holds an offline 2v2 Joker game vs bots he won 296-192 ("Homies"). It never reached `games`.

## Gaps
1. Offline games are never recorded: useGame.ts posts nothing at game over. Only the Room DO reports (room.ts:954-958, reportGame room.ts:1036-1051, index.ts:293 saveRecord).
2. Online games left early aren't recorded: recording only fires on phase gameOver (room.ts:954). leave (room.ts:714), restart (room.ts:905-925) and expiry write nothing.
3. accountTicket() (store.ts:299-311) waits at most 1.5s and then silently joins as a guest. reportGame returns early when no seat is a user (room.ts:1048). The link is only retried on hello (index.ts:429-438).
4. Only signed-in seats get rows (record.ts:58). saveRecord skips the game if there are none (record.ts:134).
5. Per-hand history is discarded; only aggregates are kept in game_players.stats (record.ts:152).
6. The header "1 games (1 today)" is server-wide (stats/boards.ts serverStats) but reads as personal.
7. personalStats has no losses, streak or recent form. Bags are counted only on made contracts (record.ts:68).
8. isRated (record.ts:93-96) and Duos (boards.ts:52-57) are already correct.

## Plan
Phase 1: record offline games (POST /api/stats/local, rated=0, source=offline, idempotent, sanity-checked, rate-limited, queued while offline); backfill the progress game as partial=1; record abandoned online games (end_reason=abandoned); show a link-status chip and retry the ticket on a timer; relabel the header; fix bags.
Phase 2: per-mode Your stats card, post-game summary with deltas, streaks and last-10 results, per-hand history JSON.
Later: partner chemistry, head-to-head, seasons, weekly titles, badges, profile graphs.

| | Elo | Duos | Wins | Accuracy/nils/bags |
|---|---|---|---|---|
| Online vs signed-in | yes | yes | vs players | yes |
| Online vs bots/guests | no | no | vs bots | yes |
| Offline vs bots | no | no | vs bots (offline) | yes |
