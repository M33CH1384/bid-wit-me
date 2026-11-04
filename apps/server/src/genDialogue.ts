/**
 * POST /api/gen-dialogue — the generated-dialogue relay (built as the
 * proto/nemotron-dialogue prototype; merged to master 2026-11-03,
 * owner-scoped): the server half of the generated-dialogue feature.
 *
 * Why a relay: the NVIDIA key must never ship inside the game bundle, so
 * the browser sends only the prototype's allowlisted public-facts payload
 * (GenPayload) and this Worker — session-authed, same as every other game
 * call — builds the prompt HERE from the shared @spades/bots builder and
 * calls NVIDIA with the key from the Worker secret NVIDIA_API_KEY.
 *
 * The reply returns RAW (the model's structured content, unvalidated) on
 * purpose: the schema check and the output fact-check stay client-side,
 * because they must run against the exact payload the client built from
 * its live game state — offline bot games never exist on this server, so
 * there is nothing here to fact-check against. The server's job is
 * custody of the key, prompt custody (the persona card is the server's
 * own DEACON_CARD, never the client's), and abuse posture:
 *   - kill-switch: 404 unless GEN_DIALOGUE_RELAY === 'on' (default off);
 *   - session auth + same-site POST (currentUser / fromSite, as elsewhere);
 *   - account allowlist: GEN_DIALOGUE_USERS (comma-separated user ids)
 *     when set, OWNER-ONLY when unset — a flipped client toggle on any
 *     other account gets a 403 and never reaches the model;
 *   - strict payload re-validation (allowlist at every level — a key
 *     shaped like a hand, deck, seed or card cannot survive it);
 *   - a per-user budget aligned with the talk engine's density (a match
 *     produces a handful of eligible moments, never a stream);
 *   - logs carry counts and timings only, never payload or line content.
 */
import {
  DEACON_CARD, GEN_LINE_KINDS, GEN_PROTO_PERSONA, buildGenPrompt,
  type GenEventKind, type GenPayload,
} from '@spades/bots';
import { type AuthEnv, currentUser, fromSite } from './auth/routes';
import { type Limit, hit } from './limits';

export interface GenDialogueEnv extends AuthEnv {
  /** `npx wrangler secret put NVIDIA_API_KEY` — never a [vars] entry, never in the bundle. */
  NVIDIA_API_KEY?: string;
  /** kill-switch: the endpoint exists only when this is exactly 'on'. Default (unset) = off. */
  GEN_DIALOGUE_RELAY?: string;
  /** account allowlist (comma-separated user ids). Unset/empty = owner-only. */
  GEN_DIALOGUE_USERS?: string;
}

/** The owner's account (M33CH) — the relay's default audience. */
export const GEN_DIALOGUE_OWNER_ID = 'ed41194162a842d61600fdf573d9a9d5';

/**
 * Who may use the relay at all (owner-scoping, 2026-11-03 — the same
 * posture as the story allowlist in story/access.ts, matched by user id
 * rather than username): the GEN_DIALOGUE_USERS list when it names
 * anyone; OWNER-ONLY when unset or empty, so the audience can never be
 * widened by accident — opening it up is a deliberate env change.
 */
export function genDialogueAllowed(env: GenDialogueEnv, uid: string): boolean {
  const list = (env.GEN_DIALOGUE_USERS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return uid === GEN_DIALOGUE_OWNER_ID;
  return list.includes(uid);
}

export interface GenRelayDeps { fetchFn?: typeof fetch }

export const GEN_MODEL = 'nvidia/nemotron-3.5-bolt-e4b';
export const GEN_UPSTREAM_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
export const GEN_RELAY_BODY_MAX = 16_384;
/** a handful per match, not per second: 12 per signed-in user per 10 minutes */
export const GEN_RELAY_BUDGET: Limit = { limit: 12, windowMs: 10 * 60_000 };
const GEN_UPSTREAM_TIMEOUT_MS = 12_000;

/** isolate-local sliding windows per user (same posture as limits.ts: an eviction just restarts them) */
const budgets = new Map<string, number[]>();

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/* ------------------------- payload re-validation ------------------------ */

export type GenPayloadCheck = { ok: true; payload: GenPayload } | { ok: false; reason: string };

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isIntIn = (x: unknown, lo: number, hi: number): x is number => isNum(x) && Number.isInteger(x) && x >= lo && x <= hi;
const isStr = (x: unknown, max: number): x is string => typeof x === 'string' && x.length <= max && !/[\u0000-\u001f\u007f]/.test(x);

function keysOk(o: Record<string, unknown>, allowed: string[], required: string[]): boolean {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) return false;
  for (const k of required) if (!(k in o)) return false;
  return true;
}
function numArr(x: unknown, maxLen: number, maxAbs: number, nullAsZero = false): number[] | null {
  if (!Array.isArray(x) || x.length > maxLen) return null;
  const out: number[] = [];
  for (const n of x) {
    // per-side count arrays can arrive with JSON nulls where the payload
    // builder left holes (setsThisMatch is index-assigned); null reads as 0
    if (n === null && nullAsZero) { out.push(0); continue; }
    if (!isNum(n) || Math.abs(n) > maxAbs) return null;
    out.push(n);
  }
  return out;
}

/**
 * Rebuild the payload field by field from the allowlist — the client's
 * object is never trusted or spread. The persona card is the server's own
 * DEACON_CARD (prompt custody); a client-sent card is discarded unread.
 */
export function validateGenPayload(raw: unknown): GenPayloadCheck {
  const bad = (reason: string): GenPayloadCheck => ({ ok: false, reason });
  if (!isObj(raw)) return bad('not-an-object');
  if (!keysOk(raw, ['v', 'event', 'speaker', 'subject', 'facts', 'personaCard', 'recentLines'], ['v', 'event', 'speaker', 'subject', 'facts'])) return bad('bad-top-keys');
  if (raw.v !== 1) return bad('bad-version');

  const ev = raw.event;
  if (!isObj(ev) || !keysOk(ev, ['id', 'kind', 'lineKind', 'handNo'], ['id', 'kind', 'lineKind', 'handNo'])) return bad('bad-event');
  if (!isStr(ev.id, 128) || ev.id.length === 0) return bad('bad-event-id');
  const kind = ev.kind as GenEventKind;
  if (kind !== 'set' && kind !== 'nilBust' && kind !== 'matchEnd') return bad('bad-kind');
  if (!(GEN_LINE_KINDS[kind] as readonly unknown[]).includes(ev.lineKind)) return bad('bad-line-kind');
  if (!isIntIn(ev.handNo, 0, 999)) return bad('bad-hand-no');

  const sp = raw.speaker;
  if (!isObj(sp) || !keysOk(sp, ['persona', 'name', 'side'], ['persona', 'name', 'side'])) return bad('bad-speaker');
  if (sp.persona !== GEN_PROTO_PERSONA) return bad('bad-persona');
  if (!isStr(sp.name, 40)) return bad('bad-speaker-name');
  if (!isIntIn(sp.side, 0, 3)) return bad('bad-speaker-side');

  const su = raw.subject;
  if (!isObj(su) || !keysOk(su, ['name', 'side', 'relation'], ['name', 'side', 'relation'])) return bad('bad-subject');
  if (!isStr(su.name, 40)) return bad('bad-subject-name');
  if (!isIntIn(su.side, 0, 3)) return bad('bad-subject-side');
  if (su.relation !== 'self-side' && su.relation !== 'opponents') return bad('bad-relation');

  const f = raw.facts;
  if (!isObj(f) || !keysOk(f, ['mode', 'targetScore', 'bids', 'contract', 'nil', 'scores', 'handPoints', 'handTricks', 'setsThisMatch', 'match', 'numbers'],
    ['mode', 'targetScore', 'bids', 'scores', 'handPoints', 'handTricks', 'setsThisMatch', 'numbers'])) return bad('bad-facts');
  if (f.mode !== 'partnership' && f.mode !== 'cutthroat') return bad('bad-mode');
  if (!isNum(f.targetScore) || f.targetScore < 0 || f.targetScore > 100_000) return bad('bad-target');
  const bids = numArr(f.bids, 8, 1000);
  const scores = numArr(f.scores, 4, 1_000_000);
  const handPoints = numArr(f.handPoints, 4, 1_000_000);
  const handTricks = numArr(f.handTricks, 4, 100);
  const setsThisMatch = numArr(f.setsThisMatch, 4, 1000, true);
  const numbers = numArr(f.numbers, 80, 1_000_000);
  if (!bids || !scores || !handPoints || !handTricks || !setsThisMatch || !numbers) return bad('bad-fact-numbers');

  const facts: GenPayload['facts'] = {
    mode: f.mode, targetScore: f.targetScore, bids, scores, handPoints, handTricks, setsThisMatch, numbers,
  };
  if (f.contract !== undefined) {
    const c = f.contract;
    if (!isObj(c) || !keysOk(c, ['bid', 'books', 'made', 'side'], ['bid', 'books', 'made', 'side'])) return bad('bad-contract');
    if (!isNum(c.bid) || !isNum(c.books) || typeof c.made !== 'boolean' || !isIntIn(c.side, 0, 3)) return bad('bad-contract');
    facts.contract = { bid: c.bid, books: c.books, made: c.made, side: c.side };
  }
  if (f.nil !== undefined) {
    const n = f.nil;
    if (!isObj(n) || !keysOk(n, ['bidderName', 'blind', 'made', 'books'], ['bidderName', 'blind', 'made', 'books'])) return bad('bad-nil');
    if (!isStr(n.bidderName, 40) || typeof n.blind !== 'boolean' || typeof n.made !== 'boolean' || !isNum(n.books)) return bad('bad-nil');
    facts.nil = { bidderName: n.bidderName, blind: n.blind, made: n.made, books: n.books };
  }
  if (f.match !== undefined) {
    const m = f.match;
    if (!isObj(m) || !keysOk(m, ['speakerSideWon', 'finalScores', 'endReason'], ['speakerSideWon', 'finalScores', 'endReason'])) return bad('bad-match');
    const finalScores = numArr(m.finalScores, 4, 1_000_000);
    if (typeof m.speakerSideWon !== 'boolean' || !finalScores || !isStr(m.endReason, 40)) return bad('bad-match');
    facts.match = { speakerSideWon: m.speakerSideWon, finalScores, endReason: m.endReason };
  }
  // the moment's defining fact must be present (the prompt builder keys off it)
  if (kind === 'set' && !facts.contract) return bad('set-needs-contract');
  if (kind === 'nilBust' && !facts.nil) return bad('nilbust-needs-nil');
  if (kind === 'matchEnd' && !facts.match) return bad('matchend-needs-match');

  let recentLines: string[] = [];
  if (raw.recentLines !== undefined) {
    if (!Array.isArray(raw.recentLines) || raw.recentLines.length > 4) return bad('bad-recent-lines');
    for (const l of raw.recentLines) { if (!isStr(l, 200)) return bad('bad-recent-lines'); recentLines.push(l); }
  }

  return {
    ok: true,
    payload: {
      v: 1,
      event: { id: ev.id as string, kind, lineKind: ev.lineKind as GenPayload['event']['lineKind'], handNo: ev.handNo as number },
      speaker: { persona: GEN_PROTO_PERSONA, name: sp.name as string, side: sp.side as number },
      subject: { name: su.name as string, side: su.side as number, relation: su.relation as GenPayload['subject']['relation'] },
      facts,
      personaCard: DEACON_CARD,
      recentLines,
    },
  };
}

/* -------------------------------- handler ------------------------------- */

export async function handleGenDialogue(req: Request, env: GenDialogueEnv, url: URL, now: number, deps: GenRelayDeps = {}): Promise<Response> {
  // kill-switch first: with the relay off, the endpoint does not exist
  if (env.GEN_DIALOGUE_RELAY !== 'on') return json({ error: 'not found' }, 404);
  if (req.method !== 'POST') return json({ error: 'not found' }, 404);
  if (!fromSite(req, env, url)) return json({ error: 'foreign origin' }, 403);
  const user = await currentUser(req, env, url, now);
  if (!user) return json({ error: 'sign-in required' }, 401);
  // account allowlist before any budget or upstream spend: the feature is
  // owner-scoped, so a signed-in stranger is refused here, cheaply
  if (!genDialogueAllowed(env, user.id)) {
    console.log(JSON.stringify({ src: 'bwm.gen', event: 'relay-forbidden' }));
    return json({ error: 'not enabled for this account' }, 403);
  }
  if (!env.NVIDIA_API_KEY) return json({ error: 'gen unavailable' }, 503);

  const b = hit(budgets.get(user.id) ?? [], now, GEN_RELAY_BUDGET);
  budgets.set(user.id, b.times);
  if (!b.ok) return json({ error: 'gen budget exhausted: try again later' }, 429);

  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > GEN_RELAY_BODY_MAX) return json({ error: 'too big' }, 413);
  const text = await req.text();
  if (text.length > GEN_RELAY_BODY_MAX) return json({ error: 'too big' }, 413);
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return json({ error: 'bad json' }, 400); }
  const v = validateGenPayload(raw);
  if (!v.ok) {
    console.log(JSON.stringify({ src: 'bwm.gen', event: 'relay-reject', reason: v.reason }));
    return json({ error: 'bad payload' }, 400);
  }

  const { system, user: userMsg } = buildGenPrompt(v.payload);
  const fetchFn = deps.fetchFn ?? fetch;
  const t0 = Date.now();
  let content: string | null = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), GEN_UPSTREAM_TIMEOUT_MS);
    try {
      const res = await fetchFn(GEN_UPSTREAM_URL, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env.NVIDIA_API_KEY}` },
        body: JSON.stringify({
          model: GEN_MODEL,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userMsg },
          ],
          // the adapter's exact settings (apps/web/src/genDialogue/adapter.ts)
          temperature: 1.0,
          top_p: 0.95,
          max_tokens: 60,
          chat_template_kwargs: { enable_thinking: false, conversational_mode: true },
        }),
      });
      if (!res.ok) {
        console.log(JSON.stringify({ src: 'bwm.gen', event: 'relay-upstream', status: res.status }));
        return json({ error: 'gen upstream' }, 502);
      }
      const j = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
      const c = j.choices?.[0]?.message?.content;
      content = typeof c === 'string' && c.length > 0 ? c : null;
    } finally { clearTimeout(timer); }
  } catch {
    return json({ error: 'gen upstream' }, 502);
  }
  if (!content) return json({ error: 'gen upstream' }, 502);
  console.log(JSON.stringify({ src: 'bwm.gen', event: 'relay-ok', kind: v.payload.event.kind, ms: Date.now() - t0 }));
  // RAW structured reply: schema + fact-check happen client-side (see header)
  return json({ content });
}
