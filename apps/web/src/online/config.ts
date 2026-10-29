/**
 * Online config. The game server URL is baked in at build time:
 *   VITE_SERVER_URL=https://bid-wit-me-server.<subdomain>.workers.dev pnpm build
 * Local dev falls back to `wrangler dev` on :8787. `?server=` overrides it (tests / debugging).
 */
export function serverUrl(): string {
  let q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('server') : null;
  try {
    if (q) sessionStorage.setItem('bwm.server', q);
    else q = sessionStorage.getItem('bwm.server');
  } catch { /* ignore */ }
  if (q) return q.replace(/\/$/, '');
  const env = (import.meta.env.VITE_SERVER_URL as string | undefined)?.trim();
  if (env) return env.replace(/\/$/, '');
  const host = typeof location !== 'undefined' ? location.hostname : 'localhost';
  return `http://${host === 'localhost' ? '127.0.0.1' : host}:8787`;
}

export const wsUrl = (code: string) => `${serverUrl().replace(/^http/, 'ws')}/api/tables/${code}/ws`;

/** Public invite link for a table. */
export function inviteLink(code: string): string {
  return `${location.origin}/t/${code}`;
}

/**
 * Streaming watch link for a table: lands the opener (guest or signed-in)
 * straight in the watch view. `broadcast` gives the OBS browser-source frame.
 * A watch link grants nothing but watching — the room's own admission
 * (spectator cap, story door, host controls) still applies on the socket.
 */
export function watchLink(code: string, broadcast = false): string {
  return `${location.origin}/watch/${code.toUpperCase()}${broadcast ? '/broadcast' : ''}`;
}

/**
 * ICE servers for WebRTC. Public STUN works for most home/mobile networks; strict NATs / corporate Wi-Fi need TURN.
 * TURN hook: the server's GET /api/ice returns Cloudflare Realtime TURN credentials once TURN_KEY_ID +
 * TURN_KEY_API_TOKEN secrets are set on the Worker; until then it returns STUN only. A build-time
 * VITE_TURN_JSON (a JSON RTCIceServer[]) can also be appended for testing.
 */
export const DEFAULT_ICE: RTCIceServer[] = [
  { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] },
];

let icePromise: Promise<RTCIceServer[]> | null = null;
export function iceServers(): Promise<RTCIceServer[]> {
  icePromise ??= (async () => {
    let list = DEFAULT_ICE;
    try {
      const r = await fetch(`${serverUrl()}/api/ice`);
      if (r.ok) list = ((await r.json()) as { iceServers: RTCIceServer[] }).iceServers;
    } catch { /* STUN only */ }
    const extra = import.meta.env.VITE_TURN_JSON as string | undefined;
    if (extra) try { list = [...list, ...(JSON.parse(extra) as RTCIceServer[])]; } catch { /* ignore */ }
    list = [...list, ...testTurn()];
    return list;
  })();
  return icePromise;
}

/**
 * Automated tests only: `?turn=<JSON RTCIceServer[]>` adds a relay on a PRIVATE address (e.g. a local test TURN
 * server). Public addresses are ignored so a crafted link can't route someone's media through a stranger's relay.
 */
function testTurn(): RTCIceServer[] {
  try {
    const raw = new URLSearchParams(location.search).get('turn') ?? sessionStorage.getItem('bwm.turn');
    if (!raw) return [];
    sessionStorage.setItem('bwm.turn', raw);
    const list = JSON.parse(raw) as RTCIceServer[];
    const priv = /^turns?:(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|localhost[:?])/;
    return list.filter((s) => [s.urls].flat().every((u) => priv.test(u)));
  } catch {
    return [];
  }
}
