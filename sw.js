// © 2026 Artivicolab. All rights reserved. ProxForm — proprietary software. See LICENSE.
// ProxForm service worker — network-first for HTML/CSS/JS, cache-first for assets.

const CACHE = 'proxform-v7';

const ASSETS = [
  '/',
  '/index.html',
  '/builder.html',
  '/forms.html',
  '/received.html',
  '/fill.html',
  '/gdpr.html',
  '/css/style.css?v=7',
  '/js/crypto.js?v=7',
  '/js/p2p.js?v=7',
  '/js/builder.js?v=7',
  '/js/fill.js?v=7',
  '/js/theme.js?v=7',
  '/js/storage.js?v=7',
  '/js/netcheck.js?v=7',
  '/js/render.js?v=7',
  '/js/import.js?v=7',
  '/js/footer.js?v=7',
  '/js/analytics.js?v=7',
  '/js/bg.js?v=7',
  '/manifest.json',
  '/icons/favicon.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isHtml = req.mode === 'navigate' || req.destination === 'document';
  const isAsset = /\.(css|js)$/.test(url.pathname);

  if (isHtml || isAsset) {
    // Network-first so version bumps reach users immediately.
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match(req).then(hit => hit || (isHtml ? caches.match('/index.html') : Response.error()))
        )
    );
    return;
  }

  // Other assets: cache-first.
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      return res;
    }))
  );
});
