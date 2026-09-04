self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open("world-monitor-v1").then((cache) => cache.addAll(["/", "/styles.css", "/app.js", "/manifest.webmanifest"]))
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/") || url.pathname === "/health" || url.pathname.startsWith("/ingest/")) return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached ?? fetch(event.request))
  );
});
