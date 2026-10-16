/** Display name + one secret seat token per table. The token is kept in localStorage and a cookie, so clearing
 *  local storage alone doesn't mint a new seat (a second tab, or a kicked player, stays the same person). */
const NAME_KEY = 'bwm.online.name';
const TOKENS_KEY = 'bwm.online.tokens';
const TOKEN_COOKIE = 'bwm_tokens';

export function loadName(): string {
  try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; }
}

/** One guest id per browser. Social presence keys off it, so a second tab or a reconnect is the same player.
 *  The cookie keeps it when local storage is empty, the same way the seat token survives. */
const GUEST_KEY = 'bwm.social.guest';
const GUEST_COOKIE = 'bwm_guest';
const GUEST_RE = /^[A-Za-z0-9_-]{8,32}$/;
let guestMem: string | null = null;
function readGuestCookie(): string {
  try {
    if (typeof document === 'undefined' || !document.cookie) return '';
    const raw = document.cookie.split('; ').map((p) => p.split('=')).find(([k]) => k === GUEST_COOKIE)?.[1];
    if (!raw) return '';
    const id = decodeURIComponent(raw);
    return GUEST_RE.test(id) ? id : '';
  } catch { return ''; }
}
function writeGuest(id: string): void {
  try { localStorage.setItem(GUEST_KEY, id); } catch { /* private mode */ }
  try {
    if (typeof document === 'undefined') return;
    document.cookie = `${GUEST_COOKIE}=${encodeURIComponent(id)}; Path=/; Max-Age=31536000; SameSite=Lax`;
  } catch { /* ignore */ }
}
export function guestSessionId(): string {
  if (guestMem && GUEST_RE.test(guestMem)) return guestMem;
  let fromLocal = '';
  try {
    const cur = localStorage.getItem(GUEST_KEY);
    if (cur && GUEST_RE.test(cur)) fromLocal = cur;
  } catch { /* private mode */ }
  guestMem = fromLocal || readGuestCookie() || mintToken().slice(0, 22);
  writeGuest(guestMem);
  return guestMem;
}
export function saveName(n: string): void {
  try { localStorage.setItem(NAME_KEY, n); } catch { /* ignore */ }
}

type TokenBook = Record<string, { token: string; at: number }>;

function readLocal(): TokenBook {
  try { return JSON.parse(localStorage.getItem(TOKENS_KEY) ?? '{}'); } catch { return {}; }
}
function readCookie(): TokenBook {
  try {
    if (typeof document === 'undefined' || !document.cookie) return {};
    const raw = document.cookie.split('; ').map((p) => p.split('=')).find(([k]) => k === TOKEN_COOKIE)?.[1];
    if (!raw) return {};
    let json = raw;
    try { json = decodeURIComponent(raw); } catch { /* already decoded */ }
    const v = JSON.parse(json) as TokenBook;
    return v && typeof v === 'object' ? v : {};
  } catch { return {}; }
}
function tokens(): TokenBook {
  const out: TokenBook = { ...readCookie() };
  for (const [k, v] of Object.entries(readLocal())) {
    if (!out[k] || (v?.at ?? 0) >= (out[k]?.at ?? 0)) out[k] = v;
  }
  return out;
}
function writeTokens(t: TokenBook): void {
  const keep = Object.fromEntries(Object.entries(t).sort((a, b) => b[1].at - a[1].at).slice(0, 20));
  try { localStorage.setItem(TOKENS_KEY, JSON.stringify(keep)); } catch { /* ignore */ }
  try {
    if (typeof document === 'undefined') return;
    document.cookie = `${TOKEN_COOKIE}=${encodeURIComponent(JSON.stringify(keep))}; Path=/; Max-Age=31536000; SameSite=Lax`;
  } catch { /* ignore */ }
}
function mintToken(): string {
  const c = globalThis.crypto;
  if (c?.getRandomValues) {
    const b = new Uint8Array(16);
    c.getRandomValues(b);
    return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.padEnd(32, '0').slice(0, 32);
}

/** The seat token for this table. Creates and stores one if this browser doesn't have it yet, so every tab hellos as the same member. */
export function tokenFor(code: string): string {
  const hit = tokens()[code]?.token;
  if (hit) return hit;
  const token = mintToken();
  saveToken(code, token);
  return tokens()[code]?.token || token;
}
export function saveToken(code: string, token: string): void {
  const t = tokens();
  t[code] = { token, at: Date.now() };
  writeTokens(t);
}
export function forgetToken(code: string): void {
  const t = tokens();
  delete t[code];
  writeTokens(t);
}
