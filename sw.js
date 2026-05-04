// Kill switch: o SW antigo cobria scope '/' e contaminava o site público.
// Este SW se desregistra na ativação e limpa caches herdados.
self.addEventListener('install', e => { e.waitUntil(self.skipWaiting()); });

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll();
    clients.forEach(c => c.navigate(c.url));
  })());
});
