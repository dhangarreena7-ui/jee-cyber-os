/* NEXUS JEE — pwa.js
   Service worker registration. Sirf http(s) par chalta hai — file:// se
   service worker register nahi ho sakta, isliye wahan chup-chaap skip kar
   dete hain (app waise bhi normal chalti rehti hai). */
(function () {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;

  function log() { if (window.console && console.log) console.log.apply(console, arguments); }

  addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js', { scope: './' }).then(function (reg) {
      log('[pwa] service worker ready — scope', reg.scope);
      /* naya version mila to agle load par apne aap apply ho jaayega
         (sw.js me self.skipWaiting() hai) */
      reg.addEventListener('updatefound', function () {
        log('[pwa] naya version mila — offline cache update ho raha hai');
      });
    }).catch(function (e) {
      if (window.console && console.warn) console.warn('[pwa] service worker register fail:', e && e.message ? e.message : e);
    });
  });
})();
