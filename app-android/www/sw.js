// AlphaSun 北海气候 — Service Worker (PWA)
// 策略：同源静态资源缓存优先（离线可开）；跨域 API（Open-Meteo / nmc / FIRMS / NMDIS 等）
// 一律直连网络且不缓存，保证气候数据始终实时，避免陈旧数据误导。
const CACHE = 'alphasun-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/data.js',
  './js/map.js',
  './vendor/leaflet.js',
  './vendor/leaflet.css',
  './vendor/chart.umd.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 跨域 API：直连网络，不缓存
  if (url.origin !== self.location.origin) {
    e.respondWith(fetch(req).catch(() => new Response('', { status: 504 })));
    return;
  }

  // 同源静态资源：缓存优先，失败回退网络，再回退首页
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
