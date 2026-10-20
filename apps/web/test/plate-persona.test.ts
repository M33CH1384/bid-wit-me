import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('plate personality', () => {
  it('labels a bot from the name for the whole game', () => {
    const src = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    const plate = src.slice(src.indexOf('data-testid={`seat-${seat}`}'), src.indexOf('<PlateFace'));
    expect(plate).toContain('platePersona(names[seat]!)');
    expect(plate).not.toContain('revealed');
    expect(plate).not.toContain('personaTag');
  });
});
