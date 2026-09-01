// Service Worker – App-Shell offline verfügbar halten.
// Bei jeder Änderung an den App-Dateien VERSION hochzählen, sonst sieht das
// iPhone die neue Fassung nicht.
const VERSION = 'v1.2.0';
const CACHE = 'heim-inventar-' + VERSION;

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/db.js',
  './js/img.js',
  './js/gemini.js',
  './js/combo.js',
  './js/backup.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE && n.startsWith('heim-inventar-')).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // Gemini-Aufrufe nie anfassen
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // nichts Fremdes cachen

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });

    const fromNet = fetch(req).then((res) => {
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    }).catch(() => null);

    if (hit) { e.waitUntil(fromNet); return hit; }        // erst Cache, Update im Hintergrund

    const net = await fromNet;
    if (net) return net;
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html') || await cache.match('./');
      if (shell) return shell;
    }
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  })());
});
