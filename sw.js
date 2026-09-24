// Service Worker – App-Shell offline verfügbar halten.
// Bei jeder Änderung an den App-Dateien VERSION hochzählen, sonst sieht das
// iPhone die neue Fassung nicht. VERSION, APP_VERSION in js/app.js und
// <meta name="app-version"> in index.html müssen übereinstimmen.
//
// Aktualisiert wird NUR über einen neuen Service Worker: install holt alle Dateien
// frisch vom Server in einen neuen Cache. Der Fetch-Handler schreibt nie in den
// Cache – sonst landen neues index.html und (per HTTP-Cache) veraltetes app.js
// nebeneinander, und die App startet nicht mehr.
const VERSION = 'v1.5.1';
const CACHE = 'heim-inventar-' + VERSION;

// Die Startbilder unter icons/splash/ stehen bewusst NICHT hier: iOS holt sie beim
// Hinzufügen zum Home-Bildschirm selbst, und 28 Bilder würden jedes Update aufblähen.
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
  './js/queue.js',
  './js/ui.js',
  './js/home.js',
  './js/gestures.js',
  './js/motion.js',
  './js/sheet.js',
  './js/onboarding.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon-180.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' umgeht den HTTP-Cache – sonst liefert GitHub Pages u. U. noch alte Dateien.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))));
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

  // Erst der eigene Versions-Cache, sonst das Netz, offline die App-Shell.
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch (_) {
      void _;
      if (req.mode === 'navigate') {
        const shell = await cache.match('./index.html') || await cache.match('./');
        if (shell) return shell;
      }
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
