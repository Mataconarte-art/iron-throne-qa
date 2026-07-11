// Service worker: offline app shell only. Never caches /api/* (auth + dynamic).
const CACHE = "iron-throne-shell-v1";
const SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/styles/tokens.css",
  "/styles/base.css",
  "/app/app.js",
  "/app/theme.js",
  "/icons/blackfyre.svg",
  "/icons/valyria.svg",
  "/icons/wall.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Never intercept API calls — always hit the network.
  if (url.pathname.startsWith("/api/")) return;
  if (event.request.method !== "GET") return;

  // Cache-first for the shell, falling back to network.
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
