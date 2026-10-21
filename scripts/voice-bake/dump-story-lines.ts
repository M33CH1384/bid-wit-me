/**
 * Dump the STORY recorded-voice worklist for the sprite bake (bake-sprites.py):
 * every story line from the scene pass's final text — storyScripts (scenes,
 * variants, mid-scenes, exchanges, play beats, callbacks, resume lines),
 * storySecrets (egg beats) and storyRail (rail lines incl. the fact variants
 * railLineFor returns, the King finalHand witness, and the rail EXCHANGE
 * threads — openers, seated replies, comebacks) — cast BY CHARACTER from
 * STORY_VOICE_CAST (storyVoice.ts), never by persona default: the sprite each
 * clip lands in is storyVoiceKey(character), the voice/speed are the cast's.
 *
 * Emits worklist entries ONLY for sprites that receive story clips (clips
 * carry state 'new', or 'have' when the exact key already lives in that
 * sprite's manifest — a collision the bake report must name). Persona clips
 * are not listed: bake-sprites.py preserves every existing segment it isn't
 * told to touch. Usage: npx tsx scripts/voice-bake/dump-story-lines.ts [out.json]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  REV_FIGURES, REV_MALCOLM_CUT_LINES,
  STORY_BID_REACT, STORY_CALLBACKS, STORY_INTRO_VARIANTS, STORY_MID_SCENES, STORY_PLAY_REACTS,
  STORY_RESUME_LINES, STORY_RETRY_FIRST, STORY_SCRIPTS, STORY_SECRETS, STORY_SIT_DOWN,
  STORY_TABLE_EXCHANGES, STORY_KING_RAIL_OUTRO, STORY_RAIL_EXCHANGES, STORY_RAIL_INTRO, STORY_RAIL_LINES,
  RAIL_NEEDLE_REPLY, STORY_VOICE_CAST, railLineFor, spokenTake, storyVoiceKey, type StoryBeat,
} from '@spades/bots';

const ROOT = join(import.meta.dirname, '../..');
const PUB = join(ROOT, 'apps/web/public/voices/v2');

export interface StoryClip {
  key: string; raw: string; kind: string; text: string; voice: string; lang: string;
  speed: number; state: 'have' | 'new'; character: string; source: string;
}

interface Beat extends StoryBeat {}

/** every story beat in the corpus, tagged with where it came from */
export function storyCorpus(): { speaker: string; line: string; source: string }[] {
  const out: { speaker: string; line: string; source: string }[] = [];
  const push = (beats: readonly Beat[] | undefined, source: string) => {
    for (const b of beats ?? []) out.push({ speaker: b.speaker, line: b.line, source });
  };
  for (const [stop, s] of Object.entries(STORY_SCRIPTS)) {
    push(s.intro, `scripts:${stop}:intro`);
    push(s.introGated, `scripts:${stop}:introGated`);
    push(s.introReturn, `scripts:${stop}:introReturn`);
    push(s.outroWin, `scripts:${stop}:outroWin`);
    push(s.outroLose, `scripts:${stop}:outroLose`);
    const v = STORY_INTRO_VARIANTS[stop];
    if (v) { push(v.second, `scripts:${stop}:variant2`); push(v.grind, `scripts:${stop}:variant3`); push(v.champion, `scripts:${stop}:variantCleared`); }
    const m = STORY_MID_SCENES[stop];
    if (m) for (const k of ['firstHand', 'pullAwayUs', 'pullAwayThem', 'nilAttempt', 'matchPoint', 'finalHand'] as const) push(m[k], `scripts:${stop}:mid:${k}`);
    const x = STORY_TABLE_EXCHANGES[stop];
    if (x) { push(x.won, `scripts:${stop}:exchange:won`); push(x.lost, `scripts:${stop}:exchange:lost`); }
    push(STORY_RETRY_FIRST[stop], `scripts:${stop}:retryFirst`);
    push(STORY_SIT_DOWN[stop], `scripts:${stop}:sitDown`);
    push(STORY_BID_REACT[stop], `scripts:${stop}:bidReact`);
    const pr = STORY_PLAY_REACTS[stop];
    if (pr) { push(pr.joker, `scripts:${stop}:play:joker`); push(pr.cut, `scripts:${stop}:play:cut`); }
    const cb = STORY_CALLBACKS[stop];
    if (cb) { push(cb.nilBusted, `scripts:${stop}:callback:nilBusted`); push(cb.bigSwing, `scripts:${stop}:callback:bigSwing`); }
    push(STORY_RESUME_LINES[stop], `scripts:${stop}:resume`);
  }
  for (const [stop, s] of Object.entries(STORY_SECRETS)) push(s.egg.beat, `secrets:${stop}:egg`);
  for (const [stop, byEvent] of Object.entries(STORY_RAIL_LINES))
    for (const [event, lines] of Object.entries(byEvent ?? {})) push(lines, `rail:${stop}:${event}`);
  for (const [stop, beats] of Object.entries(STORY_RAIL_INTRO)) push(beats, `rail:${stop}:intro`);
  push(STORY_KING_RAIL_OUTRO.win, 'rail:king:outroWin');
  push(STORY_KING_RAIL_OUTRO.lose, 'rail:king:outroLose');
  // Rail EXCHANGE threads (call-and-response): openers + seated replies
  // + comebacks are spoken lines like any other — they join the corpus.
  for (const [stop, threads] of Object.entries(STORY_RAIL_EXCHANGES)) {
    for (const t of threads ?? []) {
      out.push({ speaker: t.opener.speaker, line: t.opener.line, source: `rail:${stop}:exchange:open` });
      for (const r of t.replies) out.push({ speaker: r.speaker, line: r.line, source: `rail:${stop}:exchange:reply` });
      if (t.comeback) out.push({ speaker: t.opener.speaker, line: t.comeback, source: `rail:${stop}:exchange:comeback` });
    }
  }
  out.push({ speaker: 'dee', line: RAIL_NEEDLE_REPLY, source: 'rail:fact:porchNeedleReply' });
  // Revolutionaries deck tributes (revTributes.ts): at the Barbershop the
  // seated historians speak them — Coleman's twelve + his two Malcolm-cut
  // lines into his cast sprite, June's alternates into hers.
  for (const f of REV_FIGURES) {
    out.push({ speaker: 'mrColeman', line: f.tribute, source: `rev:${f.card}` });
    if (f.june) out.push({ speaker: 'june', line: f.june, source: `rev:${f.card}:june` });
  }
  REV_MALCOLM_CUT_LINES.forEach((line, i) => out.push({ speaker: 'mrColeman', line, source: `rev:KC:cut${i + 1}` }));
  // railLineFor's fact variants are string literals inside the selector —
  // pull them out through the function itself so they can never drift.
  const facts = { fired: 0, handNo: 1, stopsCleared: 0, attemptsAtOwnStop: 0 };
  const v1 = railLineFor('barbershop', 'bigSwing', { ...facts, attemptsAtOwnStop: 2 });
  if (v1) out.push({ ...v1, source: 'rail:fact:porchAttempts' });
  const v2 = railLineFor('barbershop', 'bigSwing', { ...facts, stopsCleared: 5 });
  if (v2) out.push({ ...v2, source: 'rail:fact:deeGrowth' });
  return out;
}

/**
 * The spoken take of a story line for its character's cast. Base rule is the
 * shared spokenTake with the CAST persona (the same persona both runtime
 * paths resolve for the character — hype's caps rule covers Trey). One
 * addition, for caps-WRITTEN characters whose cast persona carries no caps
 * flag (Lil' Man, cast lilcuz): a line written in shouting caps is read as
 * shouting, not spelled — the same lowercase/collapse transform takes.ts
 * applies to caps personas, applied when the LINE itself is caps-dominant.
 */
export function storyTake(line: string, characterId: string): string {
  const cast = STORY_VOICE_CAST[characterId]!;
  const base = spokenTake(line, cast.persona);
  if (base === undefined) throw new Error(`story line collided with a bid-number line: ${line}`);
  const letters = line.replace(/[^A-Za-z]/g, '');
  const upper = line.replace(/[^A-Z]/g, '').length;
  const capsDominant = letters.length >= 12 && upper / letters.length >= 0.6;
  if (!capsDominant) return base;
  return base.toLowerCase()
    .replace(/([!?])[!?]+/g, '$1')
    .replace(/([a-z])\1{3,}/g, '$1');
}

export interface StoryWorklist { sprites: { key: string; clips: StoryClip[] }[]; youBeats: number }

export function storyWorklist(): StoryWorklist {
  const bySprite = new Map<string, Map<string, StoryClip>>();
  let youBeats = 0;
  for (const { speaker, line, source } of storyCorpus()) {
    if (speaker === 'you') { youBeats++; continue; } // the player's own line: shown, never voiced (no cast exists for 'you')
    const cast = STORY_VOICE_CAST[speaker];
    if (!cast) throw new Error(`story speaker with no cast: ${speaker} (${source})`);
    const key = storyVoiceKey(speaker);
    const sprite = bySprite.get(key) ?? new Map<string, StoryClip>();
    bySprite.set(key, sprite);
    const prev = sprite.get(line);
    if (prev) {
      if (prev.voice !== cast.kokoro || prev.speed !== cast.speed)
        throw new Error(`same line, two casts in ${key}: "${line}" (${prev.character} vs ${speaker})`);
      continue; // same character family, same voice: one clip serves every scene
    }
    const manifest = existsSync(join(PUB, `${key}.json`))
      ? (JSON.parse(readFileSync(join(PUB, `${key}.json`), 'utf8')) as { clips: Record<string, [number, number]> }).clips
      : {};
    sprite.set(line, {
      key: line, raw: line, kind: 'story', text: storyTake(line, speaker),
      voice: cast.kokoro, lang: 'en-us', speed: cast.speed,
      state: line in manifest ? 'have' : 'new', character: speaker, source,
    });
  }
  return { sprites: [...bySprite.entries()].map(([key, clips]) => ({ key, clips: [...clips.values()] })), youBeats };
}

if (process.argv[1]?.endsWith('dump-story-lines.ts')) {
  const w = storyWorklist();
  const dst = process.argv[2] ?? join(ROOT, 'voice', 'story-worklist.json');
  writeFileSync(dst, JSON.stringify(w, null, 1));
  const clips = w.sprites.flatMap((s) => s.clips);
  const news = clips.filter((c) => c.state === 'new').length;
  console.log(`${dst}: ${w.sprites.length} sprites · ${clips.length} story clips · ${news} new · ${clips.length - news} already in manifest · ${w.youBeats} 'you' beats (text-only)`);
  for (const c of clips.filter((c) => c.state === 'have')) console.log(`  COLLISION (already recorded): [${c.key}] "${c.key.slice(0, 60)}" — ${c.character} via ${c.source}`);
}
