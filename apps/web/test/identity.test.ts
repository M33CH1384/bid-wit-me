import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgetToken, hasToken, inviteNeedsName, isPlaceholderName, markNameConfirmed, saveName, saveToken, tokenFor } from '../src/online/identity';

function installStorage() {
  const ls = new Map<string, string>();
  const ss = new Map<string, string>();
  const jar = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => ls.get(k) ?? null,
    setItem: (k: string, v: string) => { ls.set(k, v); },
    removeItem: (k: string) => { ls.delete(k); },
    clear: () => { ls.clear(); },
  });
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => ss.get(k) ?? null,
    setItem: (k: string, v: string) => { ss.set(k, v); },
    removeItem: (k: string) => { ss.delete(k); },
    clear: () => { ss.clear(); },
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
  return { ls, ss, jar };
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

describe('invite name', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('treats Guest and Player as unnamed', () => {
    expect(isPlaceholderName('Guest')).toBe(true);
    expect(isPlaceholderName(' player ')).toBe(true);
    expect(isPlaceholderName('')).toBe(true);
    expect(isPlaceholderName('Meech')).toBe(false);
  });

  it('asks on an invite, and skips a table this tab created, just named, or already sits at', () => {
    const { ls, ss } = installStorage();
    saveName('StaleNick');
    expect(inviteNeedsName('ABCDE')).toBe(true);
    expect(hasToken('ABCDE')).toBe(false);
    expect(ls.has('bwm.online.tokens')).toBe(false);

    markNameConfirmed('ABCDE');
    expect(ss.get('bwm.nameok.ABCDE')).toBe('1');
    expect(inviteNeedsName('ABCDE')).toBe(false);

    ss.delete('bwm.nameok.ABCDE');
    ss.set('bwm.created.ABCDE', '1');
    expect(inviteNeedsName('ABCDE')).toBe(false);

    ss.clear();
    expect(inviteNeedsName('ABCDE')).toBe(true);
    saveToken('ABCDE', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(hasToken('ABCDE')).toBe(true);
    expect(inviteNeedsName('ABCDE')).toBe(false);
  });
});
