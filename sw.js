/* NEXUS JEE — service worker (offline shell)
   Kaam:
     • pehli load par poori app shell (HTML/CSS/JS/icons) cache karta hai
     • navigation: pehle network, fail hone par cache se index.html -> app
       offline bhi khulti hai
     • baaki GET: stale-while-revalidate (turant cache se, background me update)
     • Supabase API (/auth/v1, /rest/v1, /realtime/v1) KABHI cache nahi hota —
       login aur data hamesha live jaata hai.

   Naya version daalne ke liye sirf VERSION badha do — activate par purana
   cache khud delete ho jaata hai. */
var VERSION = 'nexus-jee-v2';

var SHELL = [
  './',
  './index.html',
  './manifest.json',
  './style.css',
  './store.js',
  './config.js',
  './supabase.js',
  './app.js',
  './pwa.js',
  './pages/syllabus-data.js',
  './pages/syllabus.js',
  './pages/planner.js',
  './pages/calendar.js',
  './pages/lectures.js',
  './pages/mistakes.js',
  './pages/tests.js',
  './pages/analytics.js',
  './pages/settings.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon-180.png'
];

/* kabhi cache na karne wale paths (Supabase backend) */
function isApi(url) {
  var p = url.pathname;
  return p.indexOf('/auth/v1') > -1 || p.indexOf('/rest/v1') > -1 || p.indexOf('/realtime/v1') > -1 ||
         p.indexOf('/storage/v1') > -1 || p.indexOf('/functions/v1') > -1;
}

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(VERSION).then(function (c) {
      /* ek file fail ho to poora install na ruke */
      return Promise.all(SHELL.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(function () { });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === VERSION ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (isApi(url)) return;                       // Supabase live rahe

  /* navigation: network-first, offline par cached shell */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        var cp = res.clone();
        caches.open(VERSION).then(function (c) { c.put('./index.html', cp); });
        return res;
      }).catch(function () {
        return caches.match('./index.html').then(function (hit) {
          return hit || caches.match('./');
        });
      })
    );
    return;
  }

  /* baaki sab: stale-while-revalidate */
  e.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) {
          var cp = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, cp); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
