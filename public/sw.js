const CACHE = "buschdorf-v2";
const SHELL = ["/", "/style.css", "/app.js", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Network-first: bei jedem Laden wird zuerst versucht, die aktuelle Version vom
// Server zu holen. Der Cache dient nur noch als Reserve, falls kein Internet da
// ist — nicht mehr als Standardquelle. Das verhindert, dass nach einem Update
// noch tagelang eine alte Version angezeigt wird.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return; // API immer live, nie aus dem Cache

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
