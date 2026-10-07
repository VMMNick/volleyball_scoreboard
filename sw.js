/* Табло — волейбол. Офлайн-оболонка. */
const CACHE = "volley-score-v17";
const SHELL = [
  "./",
  "./index.html",
  "./display.html",
  "./live.html",
  "./mini.html",
  "./theme.css",
  "./scorebug.css",
  "./match.js",
  "./app.js",
  "./palettes.js",
  "./ui-common.js",
  "./sounds.js",
  "./remote.js",
  "./feed.js",
  "./live.js",
  "./scorebug.js",
  "./mini.js",
  "./display.js",
  "./manifest.webmanifest",
  "./fonts/barlow-condensed-latin-400.woff2",
  "./fonts/barlow-condensed-latin-600.woff2",
  "./fonts/barlow-condensed-latin-800.woff2",
  "./fonts/roboto-condensed-cyrillic-400.woff2",
  "./fonts/roboto-condensed-cyrillic-600.woff2",
  "./fonts/roboto-condensed-cyrillic-800.woff2",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
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
