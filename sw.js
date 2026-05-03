const CACHE = 'cocar-admin-v6';
const PRECACHE = [
  '/admin/dashboard.html',
  '/css/agendamento-styles.css',
  '/admin/css/dashboard.css?v=3',
  '/js/supabase-config.js',
  '/admin/js/admin-system.js?v=2',
  '/admin/js/agenda-system.js?v=2',
  '/images/logo3.png',
  '/images/logo3-192.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Supabase: sempre rede, sem cache
  if (url.hostname.includes('supabase')) return;

  // Stale-while-revalidate: entrega cache imediatamente + atualiza em background
  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(e.request).then(cached => {
        const networkFetch = fetch(e.request)
          .then(res => {
            if (res.ok) cache.put(e.request, res.clone());
            return res;
          })
          .catch(() => cached ?? new Response('Offline', { status: 503 }));

        return cached ?? networkFetch;
      })
    )
  );
});
