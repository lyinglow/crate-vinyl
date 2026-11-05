// Keeps the app itself on the phone so it opens fast and works offline.
// Your records are not here. They live in the phone's database.
const VERSION = 'crate-1.5.0';
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/store.js',
  'js/model.js',
  'js/discogs.js',
  'js/sync.js',
  'js/scanner.js',
  'js/ui.js',
  'js/exporter.js',
  'js/gallery.js',
  'js/flipper.js',
  'js/mixes.js',
  'js/views/library.js',
  'js/views/record.js',
  'js/views/scan.js',
  'js/views/match.js',
  'js/views/sell.js',
  'js/views/value.js',
  'js/views/settings.js',
  'js/views/mixes.js',
  'js/views/loved.js',
  'js/views/carousel.js',
  'vendor/zxing.min.js',
  'icons/icon.svg',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// App files: show the saved copy at once, and quietly fetch a fresh one for next time.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Discogs and pictures go straight to the network
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const fresh = fetch(req).then((res) => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => hit);
      if (hit) { e.waitUntil(fresh); return hit; }
      return fresh.then((r) => r || (req.mode === 'navigate' ? cache.match('index.html') : r));
    })
  );
});
