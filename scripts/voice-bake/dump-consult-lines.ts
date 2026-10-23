/**
 * Dump the CONSULTATION recorded-voice worklist for the bake: every clip
 * the consultation banks (consultTalk.ts) resolve to, per persona-gender
 * sprite, with the spoken take — enumerated from the CODE banks, the way
 * dump-lines.ts enumerates persona pools. (The original consultation
 * batch, fb581d61, was enumerated from the spec by an external builder
 * before consultTalk.ts existed; this dump reproduces that enumeration
 * exactly — same keys, same spoken renders, same per-sprite counts —
 * from the shipped banks, and is now the registration path: a bank line
 * that is not in this dump does not get recorded.)
 *
 * Key scheme (CONSULT_SPEC §8.3): grid takes key as `${raw}#${S}.${P}`
 * with S bucketed 0–5 then "6+", settle takes as `${raw}#T${bucket}`
 * with T bucketed 3–12 then "13+"; number-free / intro / confer lines
 * key by their raw text. Spoken renders mirror the original builder:
 * buckets speak as "6 plus" / "13 plus", asterisks never reach the
 * voice, and the hype persona's takes are lowercased with punctuation
 * runs collapsed (the caps rule in takes.ts).
 *
 * Dee's set is enumerated under recordAs 'dee' (her own cast donor and
 * reference) with assembly target sprite lilcuz-f — the shipped
 * arrangement: her grid's first template shares its raw (and therefore
 * its keys) with COMMON's, and in lilcuz-f those keys carry HER takes
 * (flagged sharedWithCommon below; the lilcuz persona's own takes for
 * the same keys were displaced at assembly, fb581d61).
 *
 * State is read against the CURRENT manifests in
 * apps/web/public/voices/v2: 'have' when the key already lives in the
 * target sprite, else 'new'. Usage:
 *   npx tsx scripts/voice-bake/dump-consult-lines.ts [out.json]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CONFER_ASK, CONFER_RESP, CONSULT_FREE, CONSULT_GRID_COMMON, CONSULT_GRID_DEE, CONSULT_GRID_SILENT,
  CONSULT_OWN, CONSULT_SETTLE_COMMON, CONSULT_SETTLE_SILENT, DEE_ACK_MISCOUNT, DEE_ACK_UNDERREAD,
  DEE_FREE, DEE_SETTLE, DEE_SETTLE_HIGH, DEE_SETTLE_LOW, DEE_SETTLE_TRIM, INTRO_COMMON, INTRO_OWN,
  INTRO_SILENT, PERSONAS, type GridTemplate, type PersonaId,
} from '@spades/bots';

const ROOT = join(import.meta.dirname, '../..');
const PUB = join(ROOT, 'apps/web/public/voices/v2');

const S_BUCKETS = ['0', '1', '2', '3', '4', '5', '6+'];
const T_BUCKETS = ['3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13+'];
const sSpoken = (s: string) => (s === '6+' ? '6 plus' : s);
const tSpoken = (t: string) => (t === '13+' ? '13 plus' : t);

function cleanSpoken(text: string, caps: boolean): string {
  let t = text.replace(/\*+/g, '');
  if (caps) {
    t = t.toLowerCase().replace(/([!?])[!?]+/g, '$1').replace(/([a-z])\1{3,}/g, '$1');
  }
  return t.replace(/\s+/g, ' ').trim();
}

export interface ConsultClip {
  key: string; raw: string; kind: 'consult'; text: string; source: string;
  state: 'have' | 'new'; sharedWithCommon?: boolean;
}
export interface ConsultSprite {
  key: string; /** assembly target sprite */
  recordAs: string; /** cast-settings / reference key this set records under */
  persona: string; gender?: 'f' | 'm'; clips: ConsultClip[];
}

const manifestOf = (sprite: string): Record<string, [number, number]> =>
  existsSync(join(PUB, `${sprite}.json`))
    ? (JSON.parse(readFileSync(join(PUB, `${sprite}.json`), 'utf8')) as { clips: Record<string, [number, number]> }).clips
    : {};

function gridClips(templates: readonly GridTemplate[], source: string, caps: boolean): ConsultClip[] {
  const out: ConsultClip[] = [];
  for (const t of templates) {
    for (const s of S_BUCKETS) {
      for (let p = 0; p < 3; p++) {
        const spoken = t.raw.replace(/\{S\}/g, sSpoken(s)).replace(/\{P\}/g, t.p[p]!);
        out.push({ key: `${t.raw}#${s}.${p}`, raw: t.raw, kind: 'consult', text: cleanSpoken(spoken, caps), source, state: 'new' });
      }
    }
  }
  return out;
}
function settleClips(raws: readonly string[], source: string, caps: boolean, tBuckets = T_BUCKETS): ConsultClip[] {
  const out: ConsultClip[] = [];
  for (const raw of raws) {
    for (const t of tBuckets) {
      out.push({ key: `${raw}#T${t}`, raw, kind: 'consult', text: cleanSpoken(raw.replace(/\{T\}/g, tSpoken(t)), caps), source, state: 'new' });
    }
  }
  return out;
}
const plainClips = (texts: readonly string[], source: string, caps: boolean): ConsultClip[] =>
  texts.map((t) => ({ key: t, raw: t, kind: 'consult' as const, text: cleanSpoken(t, caps), source, state: 'new' as const }));

const FREE_COMMON = [...CONSULT_FREE.strong, ...CONSULT_FREE.solid, ...CONSULT_FREE.light, ...CONSULT_FREE.possibleHeavy, ...CONSULT_FREE.ask, ...CONSULT_FREE.nil, ...CONSULT_FREE.cover, ...CONSULT_FREE.blind];
const DEE_REST = [
  ...DEE_FREE.strong, ...DEE_FREE.solid, ...DEE_FREE.light, ...DEE_FREE.possibleHeavy, ...DEE_FREE.shaky,
  ...DEE_FREE.ask, ...DEE_FREE.nil, ...DEE_FREE.cover, ...DEE_FREE.blind, ...DEE_FREE.boardProtect,
  ...DEE_FREE.boardChase, ...DEE_FREE.bagPressure, ...DEE_FREE.kingLeg2,
  ...DEE_ACK_MISCOUNT, ...DEE_ACK_UNDERREAD,
];

function personaSprite(persona: PersonaId, gender: 'f' | 'm'): ConsultSprite {
  const key = `${persona}-${gender}`;
  const caps = persona === 'hype';
  if (persona === 'silent') {
    const clips: ConsultClip[] = [
      ...gridClips(CONSULT_GRID_SILENT, 'consult:silentGrid', false),
      ...settleClips([CONSULT_SETTLE_SILENT], 'consult:silentSettle', false, T_BUCKETS.slice(0, 10)),
      { key: 'Nil.', raw: 'Nil.', kind: 'consult', text: 'Nil.', source: 'consult:silentNil', state: 'new' },
      { key: INTRO_SILENT, raw: INTRO_SILENT, kind: 'consult', text: '…Hey.', source: 'consult:silentIntro', state: 'new' },
    ];
    const man = manifestOf(key);
    for (const c of clips) c.state = c.key in man ? 'have' : 'new';
    return { key, recordAs: key, persona, gender, clips };
  }
  const clips: ConsultClip[] = [
    ...gridClips(CONSULT_GRID_COMMON, 'consult:grid', caps),
    ...settleClips(CONSULT_SETTLE_COMMON, 'consult:settle', caps),
    ...plainClips(FREE_COMMON, 'consult:numberFree', caps),
  ];
  // persona-own estimate lines: recorded only at cells (3,0) and (3,1)
  for (const t of CONSULT_OWN[persona] ?? []) {
    for (const [s, p] of [['3', 0], ['3', 1]] as const) {
      const spoken = t.raw.replace(/\{S\}/g, s).replace(/\{P\}/g, ['', ' and a possible', ' and a couple of maybes'][p]!);
      clips.push({ key: `${t.raw}#${s}.${p}`, raw: t.raw, kind: 'consult', text: cleanSpoken(spoken, caps), source: 'consult:personaOwn', state: 'new' });
    }
  }
  clips.push(...plainClips(INTRO_COMMON, 'consult:intro', caps));
  clips.push(...plainClips(INTRO_OWN[persona] ?? [], 'consult:introOwn', caps));
  clips.push(...plainClips(CONFER_ASK, 'consult:conferAsk', caps));
  clips.push(...plainClips(CONFER_RESP, 'consult:conferResp', caps));
  const man = manifestOf(key);
  for (const c of clips) c.state = c.key in man ? 'have' : 'new';
  return { key, recordAs: key, persona, gender, clips };
}

function deeSet(): ConsultSprite {
  const clips: ConsultClip[] = [
    ...gridClips(CONSULT_GRID_DEE, 'consult:deeGrid', false),
    ...settleClips(DEE_SETTLE, 'consult:deeSettle', false),
    ...settleClips([DEE_SETTLE_LOW], 'consult:deeSettleLow', false, ['3', '4', '5']),
    ...settleClips([DEE_SETTLE_HIGH], 'consult:deeSettleHigh', false, ['10', '11', '12', '13+']),
    ...settleClips([DEE_SETTLE_TRIM], 'consult:deeSettleTrim', false, ['5', '7', '9']),
    ...plainClips(DEE_REST, 'consult:deeRest', false),
  ];
  const commonGridRaws = new Set(CONSULT_GRID_COMMON.map((t) => t.raw));
  const man = manifestOf('lilcuz-f');
  for (const c of clips) {
    c.state = c.key in man ? 'have' : 'new';
    if (c.source === 'consult:deeGrid' && commonGridRaws.has(c.raw)) c.sharedWithCommon = true;
  }
  return { key: 'lilcuz-f', recordAs: 'dee', persona: 'dee', clips };
}

export function consultWorklist(): { sprites: ConsultSprite[] } {
  const sprites: ConsultSprite[] = [];
  for (const id of Object.keys(PERSONAS) as PersonaId[]) {
    for (const g of ['f', 'm'] as const) sprites.push(personaSprite(id, g));
  }
  sprites.push(deeSet());
  return { sprites };
}

if (process.argv[1]?.endsWith('dump-consult-lines.ts')) {
  const w = consultWorklist();
  const dst = process.argv[2] ?? join(ROOT, 'voice', 'consult-worklist.json');
  writeFileSync(dst, JSON.stringify(w, null, 1));
  const clips = w.sprites.flatMap((s) => s.clips);
  const news = clips.filter((c) => c.state === 'new').length;
  console.log(`${dst}: ${w.sprites.length} sprite entries · ${clips.length} consult clips · ${news} new · ${clips.length - news} already in manifest`);
  for (const s of w.sprites) {
    const n = s.clips.filter((c) => c.state === 'new').length;
    if (n) console.log(`  ${s.key} (recordAs ${s.recordAs}): ${n} new of ${s.clips.length}`);
  }
}
