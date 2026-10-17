# Bid Wit Me: Dynamic Voice, Phase 2 (free tier only)

Date: 2026-10-16. Constraint from Demetrius: Workers Free only. No Workers Paid plan, no Containers, no paid GPU. Workers AI's free daily allowance is allowed for the line writer. No espeak-ng in the client. This note supersedes the Phase 1 hosting options that need a paid plan (Cloudflare Containers, a rented VPS, Chatterbox on a GPU). No game code in this step.

## How a line gets a voice

The live game never synthesizes speech. For the three prototype moments (getting set, Wheels, match win), and only when the host flag `aiTalk` is on (default off), the table picks a **pre-voiced catalog line** whose facts match the hand. The line goes out in the same chat message as today, with a Pages URL for that clip. Playback uses the existing `playVoice` path. Anything that misses the catalog keeps today's canned sprite line, text and audio together.

New voice copy, and later UI copy, says **Wheels**. It does not say Boston. For this system, Wheels means a team **takes 10 or more books** in the hand, whatever they bid. If that team bid under 10, the line roasts the underbid and has to use the real numbers ("all those books and you only bid 6?"). A bid that was already 10 or more gets a celebration, still with the real bid and the real books. Scoring stays as it is. The dialogue trigger for "10 or more books taken" is a later change. It is not in this note's build.

New sentences are written off to the side. When a persona's bucket for that fact is running low, the Worker asks Workers AI for one line, validates it, and stores the text. A nightly bake turns approved text into a Kokoro clip and adds it to the catalog on the next Pages deploy. Until that clip exists, nobody hears the new sentence. A line with no clip is not shown over a different clip.

Each persona keeps the Kokoro voice id and speed already in `packages/bots/src/voices.ts`, so a catalog line and a canned line are the same person. Emotion is punctuation and caps in the text. Catalog lines speak roles ("y'all", "partner") plus a number that is in the FactSheet, so one clip is true at every table. The seated name stays in the chat text.

## What the code calls Wheels today

Two different events already exist. Neither one is "10 or more books taken, whatever the bid," and neither one changes the score on its own. This section is the current code. Scoring is not part of the voice work.

**Wheels, as scored and celebrated, is a made bid of 10 or more** (or 10 books when nobody bid).

- Team bid, during bidding: both partners have bid and the sum is at least 10. `WHEELS_AT = 10` in `apps/web/src/landCue.ts` (`wheelsFor`, lines 87–97). Cutthroat and a "books bid themselves" hand are skipped. The table posts "Wheels! {team} bid {n} books together" (`apps/web/src/Table.tsx` lines 233–240) and tags the scorebug `WHEELS` (line 1280). The glossary says the same thing (`apps/web/src/glossary.ts` line 73).
- Wheels made, at hand end: that 10-plus bid, and the team took at least `max(10, bid)` books, and `contractMade` is not false (`wheelsMade`, `landCue.ts` lines 100–108). A team that bid 12 and took 10 got set, so there is no celebration. A team that bid 8 and took 11 is not Wheels here. The supercar plays from `Table.tsx` lines 983–987.
- Books hand (no bids): a team's combined books just hit 10 (`wheelsTenthBooks`, `landCue.ts` lines 110–114; the chat line is `Table.tsx` lines 250–253). Cutthroat: one player's own books just hit 10 (`wheelsTenth`, `landCue.ts` lines 116–119; `Table.tsx` lines 243–247).
- The series counter uses the same idea (`packages/rules/src/series.ts` lines 38–39 and 93–94): partnerships count a made contract of 10 or more, or 10 or more books on a books hand; Cutthroat counts 10 or more books. It is a tally on the series card, not points.
- Trash talk fires a `wheels` moment on that same condition (`packages/bots/src/moments.ts` line 75). The canned lines are "WHEELS! 🏎️ we outta here" (`packages/bots/src/personas.ts` lines 26 and 103).

**"Boston" in the code is all 13 books**, a separate talk kind. `moments.ts` line 82 pushes `boston` when `tricks >= 13` and the contract is a number. The kind comment says "speaker's side took all 13" (`personas.ts` line 43). The quick-trash tab is labeled Boston (`apps/web/src/quickTrash.ts` line 26; `apps/web/src/TrashTalk.tsx` line 18). The pack lines say "BOSTON!" and "THIRTEEN TO ZERO!" (`packages/bots/src/pack.ts` lines 113–117). Those clips stay until a later copy pass. New lines do not use that word. All 13 books is Wheels under the new rule, since 13 is at least 10.

**Score effect: none for the name.** `scoreHand` (`packages/rules/src/scoring.ts` lines 81–89 and 124–133) pays a made contract at `+10 × bid`, or `+20 × bid` when the house rule `tenForTwoHundred` is on and the contract is at least 10. A set is `−10 × bid`. Each book past the bid is `+1` and counts as a bag. Default rules leave `tenForTwoHundred` off (`packages/rules/src/config.ts` line 161), so a made 10 is 100 points plus one point per extra book, and a bid of 6 that takes 10 is 60 contract points plus 4 bag points (64 for the hand). Taking 10 books does not add a Wheels bonus. Taking 13 does not add a Boston bonus. Voice will not change any of that.

## Where each piece runs

| Piece | Where | Why it fits the free tier |
|---|---|---|
| Who speaks, which moment | Existing `momentsFor` / `botTalk` in the table Durable Object | Already on Workers Free |
| Fact check | Pure TS next to `botTalk`: numbers and names must be on the FactSheet, length cap, existing intensity word filter | No extra service |
| Catalog audio | `apps/web/public/voices/` on Pages, same as the 5,618 canned clips | A static GET. Does not spend a Worker request |
| Line writer | Workers AI binding on `bid-wit-me-server`, `@cf/meta/llama-3.2-1b-instruct` | Free neurons. Not on the paid-only model list |
| Miss queue (text only) | A small D1 table on the existing `bid-wit-me` database | Already enabled. No audio blobs |
| Kokoro-82M | GitHub Actions, `ubuntu-latest`, the existing kokoro-onnx pipeline (`/workspace/bwm-voices`: same voices, speeds, loudness, mp3) | Standard runner. espeak-ng stays on that runner |
| Settings | Host: `aiTalk` (default off) and frequency Low/Normal/High. Player, on device: volume (already `voiceVolume`), per-persona mute, and Family mode via the existing table intensity | No new vendor |

Kokoro cannot run inside the Worker: Free plan CPU is 10 ms per invocation and memory is 128 MB ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/), confirmed 2026-10-16). The model is larger than that, and a line takes about 0.35 s of CPU on 8 cores (Phase 1 measurement). The browser build is out too: an 80–300 MB download on an iPhone, and espeak-ng must not ship to the client.

## Quotas, and how they were checked

Checked against Cloudflare, GitHub, and Hugging Face docs on 2026-10-16, plus `gh repo view` for this repo (`M33CH1384/bid-wit-me`, private).

| Limit | Number | What it means here | Source |
|---|---|---|---|
| Workers AI neurons | 10,000 / day, reset 00:00 UTC. Over the cap, calls fail. They are not billed on Free | Hard stop in our code at 8,000 | [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), updated 2026-10-15 |
| llama-3.2-1b-instruct | 2,457 neurons / M input tokens, 18,252 / M output | See the worked count below | Same pricing page |
| Text-generation rate | 300 requests / minute | Not the binding limit | [Workers AI limits](https://developers.cloudflare.com/workers-ai/platform/limits/), updated 2026-09-17 |
| Workers requests | 100,000 / day | Catalog audio must stay on Pages so voice does not eat the game's requests | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), updated 2026-10-02 |
| Workers CPU / memory | 10 ms CPU, 128 MB | Rules out in-Worker TTS | Workers limits page |
| Durable Objects | 100,000 requests / day, 13,000 GB-s / day, 5 GB SQLite, 100,000 rows written / day | One extra chat line on the socket we already have | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), updated 2026-09-30 |
| D1 | 5 million rows read / day, 100,000 rows written / day, 5 GB | Text queue only | Workers pricing, D1 section |
| KV (not used on the hot path) | 1,000 writes / day, 100,000 reads / day, 1 GB, 25 MiB / value | Included with the Worker, and too tight for every play to be a read | [KV limits](https://developers.cloudflare.com/kv/platform/limits/), updated 2026-10-08 |
| Pages files | 20,000 files on Free, 25 MiB each. This site has 200 files today | Catalog stays a small slice of the remaining ~19,800 | [Pages limits](https://developers.cloudflare.com/pages/platform/limits/), updated 2026-09-05 |
| GitHub Actions | Private repos on the Free plan: 2,000 minutes / month. `ubuntu-latest` is 4 vCPU, 16 GB RAM | Cap the bake job at 20 minutes. A daily bake is about 600 minutes / month | [Actions billing](https://docs.github.com/billing/managing-billing-for-github-actions/about-billing-for-github-actions), [runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) |

**Worked neuron count.** Pricing page rates for `@cf/meta/llama-3.2-1b-instruct`, at a 800-token prompt (FactSheet, persona, recent lines) and 40 output tokens:

`800/1e6 × 2457 + 40/1e6 × 18252 ≈ 2.70 neurons` per line. `10000 / 2.70 ≈ 3,700 lines / day` before our 8,000-neuron stop (`≈ 3,000 lines`). A shorter 400-token prompt is about 1.71 neurons and about 5,800 lines / day. The same 800+40 prompt on `@cf/meta/llama-3.1-8b-instruct-fp8-fast` (4,119 and 34,868 neurons / M) is about 4.69 neurons and about 2,100 lines / day. Use the 1B model unless its lines come out flat; the 8B fast model is still inside the free allowance. `@cf/google/gemma-4-26b-a4b-it` is about 8.4 neurons and about 1,200 lines / day at the same prompt, so leave it.

The prototype only spends neurons when a bucket is thin, not on every hand. A few set / Wheels / win lines per game stays far under 3,000.

**Kokoro.** Phase 1 timed kokoro-onnx at 0.35 s for a 1.8 s line on 8 CPU cores. The Actions runner has 4 vCPU, so treat a few hundred lines as one short job, not a live request. espeak-ng is the phonemizer on that runner only.

**R2 is not in this design.** The allowance itself is free (10 GB-month, 1 million Class A ops, 10 million Class B, egress free; [R2 pricing](https://developers.cloudflare.com/r2/pricing/), updated 2026-10-01), but turning it on is a subscription checkout ([R2 get started](https://developers.cloudflare.com/r2/get-started/), updated 2026-04-21) and Cloudflare requires a payment method so it can bill past the allowance. That fails the free-tier rule. Pages files are the clip store.

**Also rejected.** Hugging Face Gradio/Docker Spaces on free CPU Basic now require a Pro subscription (HTTP 402; [manage a Space](https://huggingface.co/docs/huggingface_hub/guides/manage-spaces)). Cloudflare Containers require Workers Paid. A warm Oracle Always Free Ampere VM is 2 OCPUs, 12 GB, and 10 TB egress / month ([Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)), and capacity is often unavailable. It is a later option only if you choose to open that tenancy. It is not part of this build.

## Caching

The catalog is the cache. Key is `sha256(voiceId | speed | normalized text)`. The prototype bakes a bounded set: 3 moments × 3 personas (hothead, og, comedian) × 2 genders × about 16 fact lines. The Wheels lines split in two: the team had already bid 10 or more, or the team bid under 10 and the line roasts that bid with the real number of books. The other buckets are set by 1, set by 2, set by 3 or more, and match win. That is on the order of 300 clips, about 12 KB each at 32 kbps mono, a few megabytes, a few hundred files against a 19,800-file remainder.

The existing `TalkState` (`used`, `recent` of 14, never twice in a row) rotates the bucket. A similarity check (token overlap over 0.6) drops a new line that restates one already stored. The client remembers clip hashes it has heard and prefers another match in the bucket. When the bucket has no fresh match, the canned sprite plays. The nightly job refills from the D1 queue and the catalog is capped so Pages stays under 20,000 files: replace the coldest clip in a full bucket instead of growing without a limit.

## Latency

A game action does not wait on voice. Catalog choice is local to the Durable Object, in the message it already sends.

| Window | Budget | What is allowed |
|---|---|---|
| The action itself | 0 ms added | Canned or catalog line is already chosen |
| Clip start | 1.5 s, the budget `playClip` already uses (`voices.ts`) | Pages mp3 via `decodeAudioData`, or the sprite |
| Normal hand end (a set, or Wheels) | 1,200 ms from the play to the score (`HAND_END_REVEAL_MS` = 500 ms flight + 700 ms) | A catalog URL in the first message. No round trip |
| That hand also ended on a Run it! / a nuke | 5,800 ms / +4,000 ms (`RUN_FX_MS`, `NUKE_ALLOWANCE_MS.full`) | Still a catalog hit. The extra time is slack, not a synth slot |
| Match win | The victory screen | Same |

A Workers AI call is 0.4–1.2 s when it runs, and it runs in `waitUntil` after the line is pushed, to fill the queue. It is not on the way to the speaker. The bake is overnight.

## Fallback

1. Catalog clip for this persona and these facts, if one is left that this table has not just heard.
2. Today's Kokoro sprite for the canned line (`playClip`).
3. Web Speech, the gender-matched voice already in `talkPrefs.ts`, with Family mode masking.
4. The chat text alone, if audio cannot start (locked iPhone, clip missed the 1.5 s budget).

Workers AI errors, a failed validation, or the 8,000-neuron stop leave the canned line in place. Three writer failures open a 5-minute breaker and the table stays on canned lines. The client plays one voice at a time, keeps at most one queued line, and drops a line whose hand or trick is already over (`handNo` / `trickNo` / `expiresAt`). A newer moment stops the clip that is playing. Sound effects are left alone.

Phase 3, after you approve this note, is the six small PRs from Phase 1 with two substitutions: clips ship as Pages files, and Kokoro runs as the Actions bake above. There is no container and no R2 binding. The host switch stays off by default, and a test has to show that a game action returns without waiting on the writer.
