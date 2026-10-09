# Bid Wit Me game server (`apps/server`)

Cloudflare **Worker + SQLite-backed Durable Objects** (Workers Free plan). One Durable Object per table.

```
POST /api/tables            → { code }            create a table (5-char code, e.g. "7KVGS")
GET  /api/tables/:code      → summary              join screen (exists? mode, seats, host)
GET  /api/tables/:code/ws   → WebSocket            the table (protocol: packages/protocol)
GET  /api/ice               → { iceServers }       STUN (+ TURN when configured)
GET  /health
```

## What the table does (src/room.ts — platform-free, unit-tested)
- **Server-authoritative**: shuffles/deals with `packages/rules` (crypto seed), validates every bid/play, and sends each
  seat only its own `PlayerView` (other hands are never on the wire).
- **Bots** (`packages/bots`) fill empty seats at start; the host can add/remove bots in the lobby; a late joiner can take
  over a bot mid-game; a player who *leaves* mid-game is replaced by a bot.
- **Turn timers** (host picks Relaxed 45/30 s · Normal 30/20 s · Fast 15/10 s). When time runs out the bot brain plays
  for that seat. A disconnected player's turn waits only ~10 s. Hand results auto-continue after 15 s.
- **Reconnect**: `hello` carries a secret seat token (localStorage per table code), so refresh / network drop / app
  switch lands you back in the same seat. A second tab replaces the first.
- **Chat** through the DO: 200 chars, 5 lines / 10 s per player, links → `[link]`, small profanity mask.
- **WebRTC signaling relay** (`{t:'rtc'}`) between seated players only. Media is peer-to-peer.
- **Nobody connected** → the table freezes (no bots, no timers, no writes). Untouched tables are deleted after 24 h.

## Moves under real-network latency

Every `act` carries `seq` (the game version from `RoomInfo.seq` the move was chosen from) and an idempotency `id`.
The server checks, in order: already-applied `id` → `ack {ok, dup}` (never applied twice, e.g. a resend after a
reconnect); `seq` ≠ current → dropped, fresh `state` + `ack {stale}` (e.g. the turn timer auto-played first, or a
double click); otherwise the rules decide (`ack {ok}` or `ack {ok:false, code}`). The client keeps one move in flight
(hand locked until the ack or a newer state), resends it with the same id/seq after a reconnect, and never shows
stale/dup as errors. The DO is single-threaded, so a late human move and the timer auto-play can't interleave:
whichever runs first bumps `seq` and the other is stale. Legacy `act` without seq/id still works (errors as `error`).

## Free-tier budget (Workers Free, Oct 2026)
- **Row writes (100k/day) are the first limit.** The whole room is one KV row; saves are debounced (one write per
  ~2 s burst of activity, forced every 10 s) — e.g. 4 humans playing at a normal pace ≈ 1 write per human move
  (~600/game), 1 human + 3 bots ≈ 150–250/game. Turn timers use one "ticking" alarm that is only re-armed when it
  fires. Rough ceiling: **~150–500 games/day** depending on how many humans per table.
- **DO requests (100k/day)**: incoming WS messages count 20:1; a 4-human game ≈ 700 messages ≈ 35 requests (+ a few
  for connects/alarms). Video signaling adds ~100 messages per table (≈5 requests). Outgoing messages are free.
- **Duration**: WebSocket Hibernation + auto ping/pong; the DO only stays awake while bots are mid-move (seconds).
- **Workers requests (100k/day)**: one per WebSocket connect + table create/info calls.
- Limits reset at 00:00 UTC (8 PM ET in summer). Upgrade to Workers Paid ($5/mo) before any marketing push.
- Trade-off: a DO restart (e.g. a deploy) can lose the last ≤2 s of moves (clients re-sync automatically).

## Video / TURN
Public STUN only (`stun.cloudflare.com:3478`, Google). That covers most home/mobile networks; **strict NATs,
some corporate/school Wi-Fi and some carriers need a TURN relay**. To enable Cloudflare Realtime TURN later
(first 1,000 GB/month free, then $0.05/GB — likely needs a payment method on file):
```
cd apps/server
npx wrangler@3 secret put TURN_KEY_ID          # from Dashboard › Realtime › TURN
npx wrangler@3 secret put TURN_KEY_API_TOKEN
```
`/api/ice` then mints 24 h credentials and the client uses them automatically (apps/web/src/online/config.ts).

## Dev / test / deploy
```
pnpm server:dev                                   # wrangler dev on :8787 (client defaults to it on localhost)
pnpm vitest run apps/server                       # room logic with mock sockets + fake clock
npx tsx scripts/online-clients.ts http://127.0.0.1:8787    # 4 WS clients play a full game incl. reconnect
node scripts/turn-local.mjs &                     # local TURN (this box's Chrome has no host candidates/UDP STUN)
TURN='<json printed above>' node scripts/online-browser.mjs http://localhost:4273   # 2 browsers, fake camera
pnpm deploy:online                                # Worker, then Pages with VITE_SERVER_URL baked in
```
