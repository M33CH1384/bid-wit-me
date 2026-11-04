/**
 * PROTOTYPE (proto/nemotron-dialogue): the dialogue-model adapter — one
 * replaceable interface, two implementations.
 *
 * MOCK is the default and is clearly labeled everywhere it surfaces: it
 * produces deterministic, fact-derived lines (genDialogue.mockGenerate)
 * so the whole pipeline — seam, schema, fact-check, fallbacks, dedupe,
 * stale-drop — is provable with no endpoint at all.
 *
 * NEMOTRON speaks OpenAI-compatible chat completions (the llama.cpp
 * server / build.nvidia.com shape) per the model's card: conversational
 * mode on, thinking OFF, max_tokens ~60, temperature 1.0 / top_p 0.95.
 * It is configured ONLY by env (VITE_GEN_DIALOGUE_URL / _MODEL / _KEY).
 * The key is a DEV-ONLY convenience: in production the URL must point at
 * the game's own server proxy, which holds the credential server-side —
 * a browser bundle can keep no secret. Unconfigured / unreachable /
 * slow → the adapter fails closed and the curated line owns the moment.
 *
 * RELAY mode is that production shape: the adapter POSTs only the
 * allowlisted payload to the game's own server (POST /api/gen-dialogue,
 * session cookie auth, same as every other game call). The server builds
 * the prompt itself and holds the NVIDIA key; it returns the model's raw
 * structured reply, which is schema-checked HERE (parseModelContent)
 * and fact-checked by the director — the gates stay client-side, where
 * the game state lives. Relay mode carries no key and no prompt.
 */
import { buildGenPrompt, mockGenerate, validateGenResponse, type GenPayload, type GenResponse } from '@spades/bots';

export interface DialogueAdapter {
  /** stable id stamped on generated TalkLines ('mock' | 'nemotron-bolt-e4b') */
  readonly id: string;
  /** true when this adapter can even attempt a call (mock: always) */
  readonly configured: boolean;
  generate(p: GenPayload, signal?: AbortSignal): Promise<GenResponse>;
}

export interface MockAdapterOptions {
  /** artificial latency (ms) so deadline behaviour is testable; 0 = immediate */
  latencyMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class MockDialogueAdapter implements DialogueAdapter {
  readonly id = 'mock';
  readonly configured = true;
  constructor(private opts: MockAdapterOptions = {}) {}
  async generate(p: GenPayload): Promise<GenResponse> {
    const wait = this.opts.latencyMs ?? 0;
    if (wait > 0) await (this.opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms))))(wait);
    return mockGenerate(p);
  }
}

export interface NemotronAdapterConfig {
  url?: string;
  model?: string;
  /** DEV ONLY — see the header. Production goes through the server proxy. */
  key?: string;
  fetchFn?: typeof fetch;
  /** RELAY mode: same-origin server path (e.g. '/api/gen-dialogue'). When
   *  set (and no direct url), generate() posts the payload to the relay. */
  relayPath?: string;
}

export class NemotronDialogueAdapter implements DialogueAdapter {
  readonly id = 'nemotron-bolt-e4b';
  constructor(private cfg: NemotronAdapterConfig) {}
  get configured(): boolean { return !!this.cfg.url || !!this.cfg.relayPath; }
  async generate(p: GenPayload, signal?: AbortSignal): Promise<GenResponse> {
    if (this.cfg.relayPath && !this.cfg.url) return this.generateViaRelay(p, signal);
    if (!this.cfg.url) throw new Error('nemotron-unconfigured');
    const { system, user } = buildGenPrompt(p);
    const fetchFn = this.cfg.fetchFn ?? fetch;
    const res = await fetchFn(this.cfg.url, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        ...(this.cfg.key ? { Authorization: `Bearer ${this.cfg.key}` } : {}),
      },
      body: JSON.stringify({
        model: this.cfg.model ?? 'nemotron-bolt',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 1.0,
        top_p: 0.95,
        max_tokens: 60,
        chat_template_kwargs: { enable_thinking: false, conversational_mode: true },
      }),
    });
    if (!res.ok) throw new Error(`nemotron-http-${res.status}`);
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = j.choices?.[0]?.message?.content;
    if (!content) throw new Error('nemotron-empty');
    // NOTE: the raw content is returned as an unvalidated GenResponse
    // shape ONLY through validateGenResponse at the director — this
    // adapter returns the parsed-or-thrown response via the same path:
    return parseModelContent(content);
  }

  /** Relay mode: payload out, raw structured reply back, gates here. */
  private async generateViaRelay(p: GenPayload, signal?: AbortSignal): Promise<GenResponse> {
    const fetchFn = this.cfg.fetchFn ?? fetch;
    const res = await fetchFn(this.cfg.relayPath!, {
      method: 'POST',
      signal,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    });
    if (!res.ok) throw new Error(`gen-relay-http-${res.status}`);
    const j = (await res.json()) as { content?: unknown };
    if (typeof j.content !== 'string' || !j.content) throw new Error('gen-relay-empty');
    return parseModelContent(j.content);
  }
}

/** Parse + schema-validate raw model content (shared by the adapter and tests). */
export function parseModelContent(content: string): GenResponse {
  const v = validateGenResponse(content);
  if (!v.ok) throw new Error(`gen-invalid:${v.reason}`);
  return v.res;
}
