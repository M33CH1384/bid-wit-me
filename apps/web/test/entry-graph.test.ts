import { readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = join(dirname(fileURLToPath(import.meta.url)), '../src');

/** Value imports only. `import type` is erased and must not count as a runtime edge. */
function valueImports(path: string): string[] {
  const text = readFileSync(path, 'utf8');
  const out: string[] = [];
  for (const m of text.matchAll(/^\s*import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm)) {
    const clause = m[1]!.trim();
    const spec = m[2]!;
    if (clause.startsWith('type ')) continue;
    if (clause.startsWith('{')) {
      const inner = clause.slice(1, clause.lastIndexOf('}'));
      const binds = inner.split(',').map((b) => b.trim()).filter(Boolean);
      if (binds.length > 0 && binds.every((b) => b.startsWith('type '))) continue;
    }
    out.push(spec);
  }
  return out;
}

function resolve(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return spec;
  const base = normalize(join(dirname(from), spec));
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    try { readFileSync(c); return c; } catch { /* next */ }
  }
  return null;
}

describe('first script on a reload', () => {
  it('does not statically import three (that download was the blank-screen stall)', () => {
    const entry = join(src, 'main.tsx');
    const seen = new Set<string>();
    const pkgs = new Set<string>();
    const queue = [entry];
    while (queue.length) {
      const path = queue.pop()!;
      if (seen.has(path) || !path.startsWith('/')) continue;
      seen.add(path);
      for (const spec of valueImports(path)) {
        const next = resolve(path, spec);
        if (!next) continue;
        if (next.startsWith('.')) continue;
        if (!next.startsWith('/')) { pkgs.add(next); continue; }
        queue.push(next);
      }
    }
    const heavy = [...pkgs].filter((p) => p === 'three' || p.startsWith('@react-three') || p === 'postprocessing');
    expect(heavy).toEqual([]);
  });
});
