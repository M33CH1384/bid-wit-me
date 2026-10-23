/**
 * Consultation × voice-manifest cross-check: every clip key the
 * consultation builders can produce must exist in the shipped sprite
 * manifests (the fb581d61 bake). A bank line edited without a matching
 * recorded take fails here instead of silently going text-only at the
 * table. Lines the spec marks text-only by design (Dee's hedged line,
 * persona settle band variants, the silent settle at 13+) are asserted
 * as the ONLY absences, by construction of the enumeration below.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CONSULT_FREE, CONSULT_GRID_COMMON, CONSULT_GRID_DEE, CONSULT_GRID_SILENT, CONSULT_OWN,
  CONSULT_SETTLE_COMMON, CONFER_ASK, CONFER_RESP, DEE_FREE, DEE_SETTLE, DEE_SETTLE_HIGH,
  DEE_SETTLE_LOW, DEE_SETTLE_TRIM, INTRO_COMMON, INTRO_OWN, INTRO_SILENT, PERSONAS,
  type PersonaId,
} from '@spades/bots';

const S = ['0', '1', '2', '3', '4', '5', '6+'];
const P = ['0', '1', '2'];
const T = ['3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13+'];

function sprite(persona: string, gender: 'f' | 'm'): Record<string, unknown> {
  const url = new URL(`../public/voices/v2/${persona}-${gender}.json`, import.meta.url);
  return (JSON.parse(readFileSync(url, 'utf8')) as { clips: Record<string, unknown> }).clips;
}

describe('consultation takes exist in the shipped sprites', () => {
  it('every persona sprite carries the full COMMON consultation set', () => {
    const missing: string[] = [];
    for (const persona of Object.keys(PERSONAS) as PersonaId[]) {
      for (const gender of ['f', 'm'] as const) {
        const clips = sprite(persona, gender);
        const has = (k: string) => { if (!(k in clips)) missing.push(`${persona}-${gender}: ${k}`); };
        if (persona === 'silent') {
          for (const t of CONSULT_GRID_SILENT) for (const s of S) for (const p of P) has(`${t.raw}#${s}.${p}`);
          for (const t of T.slice(0, -1)) has(`{T}.#T${t}`); // 13+ is text-only by design
          has('Nil.');
          has(INTRO_SILENT);
          continue;
        }
        for (const t of CONSULT_GRID_COMMON) for (const s of S) for (const p of P) has(`${t.raw}#${s}.${p}`);
        for (const raw of CONSULT_SETTLE_COMMON) for (const t of T) has(`${raw}#T${t}`);
        for (const lines of Object.values(CONSULT_FREE)) for (const raw of lines) has(raw);
        for (const raw of INTRO_COMMON) has(raw);
        for (const raw of CONFER_ASK) has(raw);
        for (const raw of CONFER_RESP) has(raw);
        for (const t of CONSULT_OWN[persona] ?? []) { has(`${t.raw}#3.0`); has(`${t.raw}#3.1`); }
        for (const raw of INTRO_OWN[persona] ?? []) has(raw);
      }
    }
    expect(missing).toEqual([]);
  });

  it("Dee's full set lives in her cast sprite (lilcuz-f)", () => {
    const clips = sprite('lilcuz', 'f');
    const missing: string[] = [];
    const has = (k: string) => { if (!(k in clips)) missing.push(k); };
    for (const t of CONSULT_GRID_DEE) for (const s of S) for (const p of P) has(`${t.raw}#${s}.${p}`);
    for (const raw of DEE_SETTLE) for (const t of T) has(`${raw}#T${t}`);
    for (const t of ['3', '4', '5']) has(`${DEE_SETTLE_LOW}#T${t}`);
    for (const t of ['10', '11', '12', '13+']) has(`${DEE_SETTLE_HIGH}#T${t}`);
    for (const t of ['5', '7', '9']) has(`${DEE_SETTLE_TRIM}#T${t}`);
    for (const lines of Object.values(DEE_FREE)) for (const raw of lines) has(raw);
    expect(missing).toEqual([]);
  });
});
