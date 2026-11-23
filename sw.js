/* 離線快取：App 本體先用快取、背景更新；資料一律走網路（Apps Script） */
var CACHE = 'wen-kakeibo-v5';
var SHELL = ['./', 'index.html', 'style.css', 'lib.js', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET' || /script\.google(usercontent)?\.com/.test(url.host)) return;
  var same = url.origin === self.location.origin, pdfjs = /cdnjs\.cloudflare\.com/.test(url.host);
  if (!same && !pdfjs) return;
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(e.request).then(function (hit) {
      var net = fetch(e.request).then(function (res) { if (res.ok) c.put(e.request, res.clone()); return res; }).catch(function () { return hit; });
      return hit || net;
    });
  }));
});
