const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const RUNTIME = `runtime-${VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './icons/icon.svg',
  './icons/maskable.svg',
  './js/util.js',
  './js/db.js',
  './js/source.js',
  './js/cbz.js',
  './js/downloader.js',
  './js/library.js',
  './js/viewer.js',
  './js/settings.js',
  './js/app.js',
  'https://cdn.jsdelivr.net/npm/dexie@4.0.8/dist/dexie.min.js',
  'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL)
      .then(c => Promise.allSettled(ASSETS.map(a => c.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== RUNTIME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;

  if (sameOrigin) {
    if (req.mode === 'navigate') {
      e.respondWith(
        fetch(req).then(res => {
          const copy = res.clone();
          caches.open(SHELL).then(c => c.put(req, copy));
          return res;
        }).catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
      );
      return;
    }
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(SHELL).then(c => c.put(req, copy));
        return res;
      }))
    );
    return;
  }

  /* 外部: CDN と画像ホスト */
  if (url.hostname.endsWith('jsdelivr.net')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(SHELL).then(c => c.put(req, copy));
      return res;
    })));
    return;
  }
});