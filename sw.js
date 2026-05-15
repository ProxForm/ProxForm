// © 2026 Artivicolab. All rights reserved. ProxForm — proprietary software. See LICENSE.
// ProxForm service worker — network-first for HTML/CSS/JS, cache-first for assets.

const CACHE = 'proxform-v9';

const ASSETS = [
  '/',
  '/index.html',
  '/builder.html',
  '/forms.html',
  '/received.html',
  '/fill.html',
  '/gdpr.html',
  '/import.html',
  '/404.html',
  '/css/style.css?v=9',
  '/js/crypto.js?v=9',
  '/js/p2p.js?v=9',
  '/js/builder.js?v=9',
  '/js/fill.js?v=9',
  '/js/theme.js?v=9',
  '/js/storage.js?v=9',
  '/js/netcheck.js?v=9',
  '/js/render.js?v=9',
  '/js/cond.js?v=9',
  '/js/sig.js?v=9',
  '/js/import.js?v=9',
  '/js/templates.js?v=9',
  '/js/footer.js?v=9',
  '/js/analytics.js?v=9',
  '/js/bg.js?v=9',
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
          caches.match(req).then(hit => hit || (isHtml ? caches.match('/404.html') : Response.error()))
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
