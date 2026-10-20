/* Bid Wit Me push service worker (Release 13).
 * Receives Web Push messages (VAPID + RFC 8291), shows the notification,
 * and opens/focuses the right table on tap. Registered from src/push/push.ts.
 */

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    /* ignore malformed payloads */
  }
  const title = data.title || 'Bid Wit Me';
  const url = typeof data.url === 'string' ? data.url : '/';
  event.waitUntil(
    (async () => {
      // Don't double-notify: a visible tab already on this table means the
      // player is watching — the server also skips live sockets, this is the backstop.
      if (url.startsWith('/t/')) {
        try {
          const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
          for (const c of clients) {
            try {
              if (new URL(c.url).pathname === url && c.visibilityState === 'visible') return;
            } catch {
              /* ignore bad client urls */
            }
          }
        } catch {
          /* matchAll failed — show the notification anyway */
        }
      }
      await self.registration.showNotification(title, {
        body: data.body || '',
        icon: '/favicon.svg',
        badge: '/favicon.svg',
        tag: data.tag || 'bwm',
        renotify: false,
        data: { url },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || '/';
  // Keep the query string: invite pushes link to /t/CODE?seat=N and the seat
  // reservation is lost if we open just the pathname.
  let target = '/';
  try {
    const u = new URL(raw, self.location.origin);
    target = u.pathname + u.search;
  } catch {
    /* keep default */
  }
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of clients) {
        try {
          const cu = new URL(c.url);
          if (cu.pathname + cu.search === target) {
            await c.focus();
            return;
          }
        } catch {
          /* ignore */
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
