/** No accounts yet: a display name + one secret seat token per table code, all in localStorage. */
const NAME_KEY = 'bwm.online.name';
const TOKENS_KEY = 'bwm.online.tokens';

export function loadName(): string {
  try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; }
}
export function saveName(n: string): void {
  try { localStorage.setItem(NAME_KEY, n); } catch { /* ignore */ }
}

function tokens(): Record<string, { token: string; at: number }> {
  try { return JSON.parse(localStorage.getItem(TOKENS_KEY) ?? '{}'); } catch { return {}; }
}
export function tokenFor(code: string): string | undefined {
  return tokens()[code]?.token;
}
export function saveToken(code: string, token: string): void {
  try {
    const t = tokens();
    t[code] = { token, at: Date.now() };
    // keep the 20 most recent tables
    const keep = Object.entries(t).sort((a, b) => b[1].at - a[1].at).slice(0, 20);
    localStorage.setItem(TOKENS_KEY, JSON.stringify(Object.fromEntries(keep)));
  } catch { /* ignore */ }
}
export function forgetToken(code: string): void {
  try {
    const t = tokens();
    delete t[code];
    localStorage.setItem(TOKENS_KEY, JSON.stringify(t));
  } catch { /* ignore */ }
}
