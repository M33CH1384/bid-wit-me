import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Source pins for the "Fresh table talk — Deacon" settings toggle: the pref
// defaults OFF, the gen wiring consults it first, and the Settings sheet
// renders the switch wired to the same pref. Behaviour of the pref store
// itself (persistence, old saves, no pinning) is covered in talkPrefs.test.ts.
describe('gen dialogue toggle wiring', () => {
  const prefs = readFileSync(new URL('../src/talkPrefs.ts', import.meta.url), 'utf8');
  const wiring = readFileSync(new URL('../src/genDialogue/wiring.ts', import.meta.url), 'utf8');
  const dock = readFileSync(new URL('../src/SoundControls.tsx', import.meta.url), 'utf8');

  it('the pref defaults off', () => {
    expect(prefs).toContain('genDialogue: false');
  });

  it('the wiring checks the settings toggle before the dev overrides', () => {
    const at = wiring.indexOf('export function genDialogueEnabled');
    const body = wiring.slice(at, at + 500);
    expect(body).toContain('talkPrefs.get().genDialogue');
    expect(body.indexOf('talkPrefs.get().genDialogue')).toBeLessThan(body.indexOf('VITE_GEN_DIALOGUE'));
  });

  it('the settings sheet shows the switch bound to the same pref', () => {
    expect(dock).toContain('data-testid="gen-dialogue"');
    expect(dock).toContain('Fresh table talk — Deacon');
    expect(dock).toContain('talkPrefs.set({ genDialogue: !t.genDialogue })');
    expect(dock).toContain('aria-checked={t.genDialogue}');
  });

  it('both hooks stay inert unless the feature is enabled', () => {
    expect(wiring).toContain('export function genBanterHook');
    expect(wiring).toContain('export function genMatchEndHook');
    expect(wiring.match(/if \(!genDialogueEnabled\(\)\) return false;/g)).toHaveLength(2);
  });
});
