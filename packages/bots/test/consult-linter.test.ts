import { describe, expect, it } from 'vitest';
import {
  PARTNER_TALK_PRESETS,
  allConsultBankStrings,
  renderGrid,
  renderSettle,
  CONSULT_GRID_COMMON,
  CONSULT_GRID_DEE,
  CONSULT_GRID_SILENT,
  CONSULT_OWN,
  DEE_HEDGED,
  type GridTemplate,
} from '../src';

/**
 * CONSULT_SPEC §7.1 — the no-card-disclosure linter. Every consultation /
 * introduction / settle / confer line, display AND spoken forms, fully
 * instantiated over the whole grid, is run against the forbidden list.
 * Consultation speech may carry the count, the possibles, the confidence,
 * and the score context — never what cards anyone holds.
 *
 * Two patterns are scoped to card contexts, because the spec's own banks
 * use the innocent forms: single-letter ranks ("I got a little something.
 * A *little* something." — a sentence-start article) and spelled ranks
 * ("Counts on three." — a count, the feature itself). What is banned is
 * the rank AS A CARD: "the A", "A♠", "a ten", "the ten of…".
 */
const FORBIDDEN: [string, RegExp][] = [
  ['suit word or glyph', /spades?|hearts?|diamonds?|clubs?|♠|♥|♦|♣/i],
  ['rank or card name', /\b(ace|king|queen|jack|joker|deuce)\b/i],
  ['spelled rank as a card', /\b(?:an?|the)\s+(ten|nine|eight|seven|six|five|four|three|two)\b/i],
  ['single-letter rank as a card', /\bthe\s+[AKQJ]\b|\b[AKQJ][♠♥♦♣]|\b[AKQJ]\s+of\b/],
  ['distribution talk', /\bvoid\b|\bsingleton\b|\bdoubleton\b|\bshort in\b|\blong in\b|four of them|all (red|black)/i],
  ['possession of a card', /I got the (ace|king|queen|jack|joker|big|little)\b|I'm holding\b|I am holding\b/i],
  ['the word trump', /trump/i],
];

function instantiations(): string[] {
  const out = new Set<string>();
  const grids: GridTemplate[] = [
    ...CONSULT_GRID_COMMON, ...CONSULT_GRID_DEE, ...CONSULT_GRID_SILENT, DEE_HEDGED,
    ...Object.values(CONSULT_OWN).flatMap((ts) => ts ?? []),
  ];
  for (const t of grids) {
    for (const s of [0, 1, 2, 3, 4, 5, 6, 7]) {
      for (const p of [0, 1, 2] as const) out.add(renderGrid(t, s, p));
    }
    out.add(t.raw);
  }
  for (const raw of allConsultBankStrings()) {
    out.add(raw);
    if (raw.includes('{T}')) for (const t of [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) out.add(renderSettle(raw, t));
    if (raw.includes('{name}')) out.add(raw.replace(/\{name\}/g, 'Testname'));
  }
  for (const preset of PARTNER_TALK_PRESETS) out.add(preset);
  return [...out];
}

describe('consultation no-disclosure linter (§7.1)', () => {
  it('no bank line, fully instantiated, discloses a card', () => {
    const lines = instantiations();
    expect(lines.length).toBeGreaterThan(400); // the enumeration is real, not a sample
    const violations: string[] = [];
    for (const line of lines) {
      // display form and spoken-take form (asterisks stripped, caps folded)
      for (const form of [line, line.replace(/\*+/g, '')]) {
        for (const [name, re] of FORBIDDEN) if (re.test(form)) violations.push(`${name}: ${line}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('the purged strings are gone from partnerTalk (§7.2)', () => {
    expect(PARTNER_TALK_PRESETS).not.toContain('Strong in spades');
    for (const preset of PARTNER_TALK_PRESETS) expect(/spade/i.test(preset)).toBe(false);
  });
});
