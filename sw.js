// Service Worker: оболочка приложения + кэш библиотеки/WASM с CDN.
// Файлы моделей Transformers.js кэширует сама (Cache API, "transformers-cache").

const SHELL = 'shell-v1';
const RUNTIME = 'runtime-v1';
const ASSETS = [
  './', './index.html', './app.js', './imgproc.js', './styles.css',
  './manifest.webmanifest', './icon-192.png', './icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith('shell-') && k !== SHELL) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Свои файлы: сначала кэш, в фоне обновляем (stale-while-revalidate)
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      const hit = await caches.match(req, { ignoreSearch: true });
      const net = fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined));
      if (hit) { e.waitUntil(net); return hit; }
      return net;
    })());
    return;
  }

  // Библиотека и WASM-рантайм с jsDelivr: кэш в первую очередь
  if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
  }
});
