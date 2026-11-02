self.addEventListener('push', event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text() || 'Ton live TikTok a commencé.' };
  }

  const message = payload.body || 'Un nouvel événement TikTok a été détecté.';
  const type = payload.type || 'LIVE_STARTED';
  const title = payload.title || 'GRYPHON ARCADE · TIKTOK';
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({ type, title, message });
    }
    await self.registration.showNotification(title, {
      body: message,
      tag: payload.tag || `tiktok-${type.toLowerCase()}`,
      renotify: true,
      data: { url: payload.url || '/live-alerts.html?live=1' }
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/live-alerts.html?live=1', self.location.origin).href;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = clients.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.navigate(target);
      await existing.focus();
      return;
    }
    await self.clients.openWindow(target);
  })());
});
