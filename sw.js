// © 2026 Artivicolab. All rights reserved. ProxForm — proprietary software. See LICENSE.
// ProxForm service worker — network-first for HTML/CSS/JS, cache-first for assets.

const CACHE = 'proxform-v12';

const ASSETS = [
  '/',
  '/index.html',
  '/app.html',
  '/builder.html',
  '/forms.html',
  '/received.html',
  '/fill.html',
  '/gdpr.html',
  '/hipaa.html',
  '/import.html',
  '/404.html',
  '/css/style.css?v=12',
  '/js/crypto.js?v=12',
  '/js/p2p.js?v=12',
  '/js/sessions.js?v=12',
  '/js/builder.js?v=12',
  '/js/dashboard.js?v=12',
  '/js/router.js?v=12',
  '/js/dialog.js?v=12',
  '/js/shield.js?v=12',
  '/js/fill.js?v=12',
  '/js/theme.js?v=12',
  '/js/storage.js?v=12',
  '/js/netcheck.js?v=12',
  '/js/render.js?v=12',
  '/js/cond.js?v=12',
  '/js/sig.js?v=12',
  '/js/import.js?v=12',
  '/js/templates.js?v=12',
  '/js/footer.js?v=12',
  '/js/analytics.js?v=12',
  '/js/bg.js?v=12',
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
