/**
 * Pronunciation dictionary: display text → spoken form. ONE shared place, consumed by BOTH
 * speech paths so they can't drift:
 *   - the recorded bake (scripts/voice-bake, via takes.ts `spokenTake`), and
 *   - the Web Speech fallback (apps/web/src/talkPrefs.ts), which used to hand-code only the
 *     mm-hm fix — and only on one of its branches.
 *
 * The text players SEE never changes; only the string handed to a voice changes. Every entry
 * below was verified against espeak-ng IPA (the phonemizer Kokoro-82M and the bake use) —
 * the "before" reading is what the dictionary-reader did with the raw token:
 *
 *   mm-hm  → spelled out letter by letter (ɛm ɛm eɪtʃ ɛm). "hmm hmm" phonemizes to həm həm:
 *            two clean hums, the rhythm mm-hm actually has. (Owner report, 2026-10-21.)
 *   chile  → tʃɪli ("chilly"; browser voices said "chee-lay"). Slang for "child", said easy:
 *            "chyle" phonemizes to exactly tʃaɪl. (Owner report, 2026-10-21.)
 *   tryna  → tɹiːnə ("treena"). "try nuh" phonemizes to tɹaɪ nʌ, the slang reading.
 *   QED    → kɛd ("ked"). Spelled out as "Q E D" it reads kjuː iː diː, how people say it.
 *   'em/em → ɛm, the letter name. "um" (ʌm) is the reduced grunt the slang actually is.
 *   mm     → spelled "em em". As a standalone token it's a hum: "hmm" (həm).
 *   nil    → already nɪl in espeak, but some browser voices read the country ("Nile").
 *            "nill" is nɪl everywhere; IPA-identical here, so it forces no re-bakes.
 *   hmph   → spelled out letter by letter (eɪtʃ ɛm piː eɪtʃ). "humph" phonemizes to
 *            hʌmf: the grunt itself. (Found in the story corpus, 2026-10-21 story bake.)
 *   Mae    → miː ("mee") in espeak — Sister Mae's name said wrong in 13 story lines.
 *            "May" phonemizes to meɪ, how the name is actually said. The modal verb is
 *            spelled "may", never "mae", so the respelling can only touch the name.
 *
 * To add an entry: add a rule, check its IPA (kokoro_onnx Tokenizer.phonemize), and let the
 * corpus pin in test/pronounce.test.ts prove no speakable line's spoken form still carries
 * the raw token. Rules run in order; put longer/compound tokens before their parts (mm-hm
 * before mm).
 */
export interface PronunciationRule { match: RegExp; spoken: string; note: string }

export const PRONUNCIATION_RULES: PronunciationRule[] = [
  { match: /\bmm-hm\b/gi, spoken: 'hmm hmm', note: 'agreement hum, two beats — never spelled out' },
  { match: /\bchile\b/gi, spoken: 'chyle', note: 'slang "child" ≈ tʃaɪl, not the country' },
  { match: /\btryna\b/gi, spoken: 'try nuh', note: '"trying to", slang reduction' },
  { match: /\bqed\b/gi, spoken: 'Q E D', note: 'said as letters, not "ked"' },
  { match: /\bmm\b/gi, spoken: 'hmm', note: 'standalone hum (storyteller\'s "mm.")' },
  { match: /'em\b|\bem\b/gi, spoken: 'um', note: 'reduced "them", not the letter M' },
  { match: /\bnil\b/gi, spoken: 'nill', note: 'zero, not the river; IPA-identical in espeak' },
  { match: /\bhmph\b/gi, spoken: 'humph', note: 'a grunt (hʌmf), never spelled H-M-P-H' },
  { match: /\bMae\b/g, spoken: 'May', note: 'Sister Mae’s name: meɪ, not espeak’s miː ("mee")' },
];

/** The spoken form of a line's text: dictionary respellings applied, display text untouched. */
export function applyPronunciation(text: string): string {
  let out = text;
  for (const r of PRONUNCIATION_RULES) out = out.replace(r.match, r.spoken);
  return out;
}
