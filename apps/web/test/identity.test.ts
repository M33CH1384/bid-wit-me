import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgetToken, saveToken, tokenFor } from '../src/online/identity';

function installStorage() {
  const ls = new Map<string, string>();
  const jar = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => ls.get(k) ?? null,
    setItem: (k: string, v: string) => { ls.set(k, v); },
    removeItem: (k: string) => { ls.delete(k); },
    clear: () => { ls.clear(); },
  });
  vi.stubGlobal('document', {
    get cookie() { return [...jar].map(([k, v]) => `${k}=${v}`).join('; '); },
    set cookie(raw: string) {
      const pair = raw.split(';')[0] ?? '';
      const i = pair.indexOf('=');
      if (i < 0) return;
      const key = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (/Max-Age=0/.test(raw)) jar.delete(key);
      else jar.set(key, value);
    },
  });
  return { ls, jar };
}

describe('seat token', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('mints one token per table and keeps it when local storage is cleared', () => {
    const { ls } = installStorage();
    const a = tokenFor('ABCDE');
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(tokenFor('ABCDE')).toBe(a);
    expect(tokenFor('ZZZZZ')).not.toBe(a);
    ls.clear();
    expect(tokenFor('ABCDE')).toBe(a);
    forgetToken('ABCDE');
    expect(tokenFor('ABCDE')).not.toBe(a);
  });

  it('a newer local token wins over the cookie', () => {
    installStorage();
    saveToken('ABCDE', '11111111111111111111111111111111');
    const book = JSON.parse(localStorage.getItem('bwm.online.tokens')!) as { ABCDE: { token: string; at: number } };
    book.ABCDE = { token: '22222222222222222222222222222222', at: book.ABCDE.at + 10 };
    localStorage.setItem('bwm.online.tokens', JSON.stringify(book));
    expect(tokenFor('ABCDE')).toBe('22222222222222222222222222222222');
  });
});
