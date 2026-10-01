// Service Worker – App-Shell offline verfügbar halten.
// Die Versionsnummer kommt aus js/version.js (APP_VERSION). Sie steht hier bewusst noch einmal
// als Konstante: iOS erkennt ein Update nur, wenn sich sw.js selbst ändert (importScripts zählt
// dort nicht verlässlich). tests/consistency.spec.js erzwingt, dass beide gleich sind, und dass
// ASSETS alle Dateien aus js/ und css/ enthält.
//
// Aktualisiert wird NUR über einen neuen Service Worker: install holt alle Dateien
// frisch vom Server in einen neuen Cache. Der Fetch-Handler schreibt nie in den
// Cache – sonst landen neues index.html und (per HTTP-Cache) veraltetes app.js
// nebeneinander, und die App startet nicht mehr.
const VERSION = 'v2.0.1';
const CACHE = 'heim-inventar-' + VERSION;

// Die Startbilder unter icons/splash/ stehen bewusst NICHT hier: iOS holt sie beim
// Hinzufügen zum Home-Bildschirm selbst, und 28 Bilder würden jedes Update aufblähen.
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/version.js',
  './js/backup.js',
  './js/cabinet.js',
  './js/combo.js',
  './js/crypto.js',
  './js/db-core.js',
  './js/db-places.js',
  './js/db.js',
  './js/docs.js',
  './js/gdrive.js',
  './js/gemini.js',
  './js/gestures.js',
  './js/glass.js',
  './js/home.js',
  './js/img.js',
  './js/intro.js',
  './js/lazy.js',
  './js/match.js',
  './js/motion.js',
  './js/nav.js',
  './js/onboarding.js',
  './js/places.js',
  './js/queue.js',
  './js/scan.js',
  './js/select.js',
  './js/settings-backup.js',
  './js/sheet.js',
  './js/sound.js',
  './js/state.js',
  './js/toast.js',
  './js/ui.js',
  './js/view-add.js',
  './js/view-item.js',
  './js/view-list.js',
  './js/view-noplace.js',
  './js/view-orte.js',
  './js/view-room.js',
  './js/view-settings.js',
  './js/where.js',
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
