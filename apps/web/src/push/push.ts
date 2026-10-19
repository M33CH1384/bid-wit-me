/**
 * Web Push client (Release 13): service-worker registration, permission,
 * subscription management, and per-type preferences.
 */
export type NotifType =
  | 'turn' | 'invite' | 'friend_online' | 'achievement'
  | 'daily' | 'rankup' | 'challenge' | 'season';

export const NOTIF_TYPES: { type: NotifType; label: string; hint: string }[] = [
  { type: 'turn', label: 'Your turn', hint: 'When your bid or play is up and the app is closed' },
  { type: 'invite', label: 'Game invites', hint: 'When someone invites you to a table' },
  { type: 'friend_online', label: 'Friend online', hint: 'When a friend comes on the block (max hourly)' },
  { type: 'achievement', label: 'Achievements', hint: 'When you unlock an achievement' },
  { type: 'daily', label: 'Daily bonus', hint: 'When your daily coins are ready' },
  { type: 'rankup', label: 'Rank ups', hint: 'When your division goes up' },
  { type: 'challenge', label: 'Challenges', hint: 'When a challenge hits 100%' },
  { type: 'season', label: 'Season ending', hint: 'One reminder before the season ends' },
];

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export type PermState = 'default' | 'granted' | 'denied' | 'unsupported';

export async function permissionState(): Promise<PermState> {
  if (!pushSupported()) return 'unsupported';
  return Notification.permission as PermState;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const api = (path: string, init?: RequestInit) =>
  fetch(`/api/push${path}`, { credentials: 'same-origin', ...init });

/** Register the SW, ask permission, subscribe, and save the subscription. Returns an error string or null. */
export async function enablePush(): Promise<string | null> {
  try {
    if (!pushSupported()) return 'Push notifications are not supported in this browser.';
    if (Notification.permission === 'denied') return 'Notifications are blocked — allow them in your browser settings first.';
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    let perm: NotificationPermission = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();
    if (perm !== 'granted') return 'Permission not granted — no notifications.';
    const keyRes = await api('/vapid-key');
    if (!keyRes.ok) return 'Push is not set up on the server yet. Try again later.';
    const { publicKey } = (await keyRes.json()) as { publicKey?: string };
    if (!publicKey) return 'Push is not set up on the server yet. Try again later.';
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });
    const keys = sub.toJSON().keys;
    const save = await api('/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint, keys, ua: navigator.userAgent.slice(0, 200) }),
    });
    if (!save.ok) return 'Could not save the subscription. Try again.';
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Could not enable notifications.';
  }
}

/** Remove this device's subscription (server + browser). */
export async function disablePush(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await api('/unsubscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => undefined);
      await sub.unsubscribe().catch(() => undefined);
    } else {
      // No local subscription found (iOS quirk) — clear all server-side subscriptions for this user
      await api('/unsubscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ all: true }),
      }).catch(() => undefined);
    }
  } catch {
    /* best-effort */
  }
}

export async function loadPrefs(): Promise<Record<NotifType, boolean>> {
  const r = await api('/prefs');
  if (!r.ok) throw new Error('prefs failed');
  const j = (await r.json()) as { prefs: Record<NotifType, boolean> };
  return j.prefs;
}

export async function savePref(type: NotifType, enabled: boolean): Promise<void> {
  const r = await api('/prefs', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type, enabled }),
  });
  if (!r.ok) throw new Error('save failed');
}

/** Fire a test push to this user's devices. Returns an error string or null. */
export async function sendTestPush(): Promise<string | null> {
  try {
    const r = await api('/test', { method: 'POST' });
    if (r.status === 429) return 'Slow down — one test per minute.';
    if (!r.ok) return 'Test failed. Is push enabled on this device?';
    const j = (await r.json()) as { sent?: number };
    return j.sent ? null : 'No devices subscribed — enable notifications on this device first.';
  } catch {
    return 'Test failed. Check your connection.';
  }
}
