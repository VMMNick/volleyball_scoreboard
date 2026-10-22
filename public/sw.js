/* Табло — волейбол. Офлайн-оболонка. */
const CACHE = "volley-score-8e2cfd909a";
const SHELL = [
  "./",
  "./display.html",
  "./index.html",
  "./live.html",
  "./mini.html",
  "./manifest.webmanifest",
  "./css/pages/display.css",
  "./css/pages/live.css",
  "./css/pages/mini.css",
  "./css/pages/pult.css",
  "./css/scorebug.css",
  "./css/theme.css",
  "./js/config.js",
  "./js/core/match.js",
  "./js/core/palettes.js",
  "./js/pages/display.js",
  "./js/pages/live.js",
  "./js/pages/mini.js",
  "./js/pages/pult.js",
  "./js/shared/archive.js",
  "./js/shared/feed.js",
  "./js/shared/link.js",
  "./js/shared/remote.js",
  "./js/shared/scorebug.js",
  "./js/shared/sounds.js",
  "./js/shared/ui-common.js",
  "./assets/fonts/barlow-condensed-latin-400.woff2",
  "./assets/fonts/barlow-condensed-latin-600.woff2",
  "./assets/fonts/barlow-condensed-latin-800.woff2",
  "./assets/fonts/roboto-condensed-cyrillic-400.woff2",
  "./assets/fonts/roboto-condensed-cyrillic-600.woff2",
  "./assets/fonts/roboto-condensed-cyrillic-800.woff2",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-maskable-512.png",
  "./assets/logos/uvl-new.webp",
  "./assets/logos/uvl-old.webp"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    // cache: "reload" — повз HTTP-кеш браузера: інакше нова версія могла б зберегти старі скрипти.
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  // Навігація: спершу мережа, офлайн — з кешу.
  if (req.mode === "navigate") {
    e.respondWith(
      // display.html?layout=strip теж має відкритись офлайн, а не впасти на пульт.
      fetch(req).catch(() =>
        caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match("./index.html"))
      )
    );
    return;
  }

  // Решта: кеш, потім мережа з дозаписом.
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok && req.url.startsWith(self.location.origin)) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);
    })
  );
});
