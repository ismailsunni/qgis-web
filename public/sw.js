// QuarkGIS service worker.
// 1. Adds COOP/COEP headers so the page is cross-origin isolated (needed for multithreaded
//    WebAssembly) on static hosts that can't set headers, like GitHub Pages.
// 2. Caches the QGIS engine (assets/wasm, ~20 MB compressed) per qgis-js version, so later
//    visits start without downloading it again.
const version = new URL(location.href).searchParams.get("v") ?? "dev";
const ENGINE_CACHE = `quarkgis-engine-${version}`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith("quarkgis-engine-") && key !== ENGINE_CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);

async function engineAsset(request) {
  const cache = await caches.open(ENGINE_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === location.origin;
  // The documentation isn't the app: no isolation, so its pages can load third-party fonts and scripts.
  if (request.mode === "navigate" && url.pathname.includes("/docs/")) return;
  event.respondWith(
    (async () => {
      const response = sameOrigin && url.pathname.includes("/assets/wasm/") ? await engineAsset(request) : await fetch(request);
      if (response.status === 0) return response;
      const headers = new Headers(response.headers);
      headers.set("Cross-Origin-Embedder-Policy", "require-corp");
      headers.set("Cross-Origin-Opener-Policy", "same-origin");
      if (sameOrigin) headers.set("Cross-Origin-Resource-Policy", "same-origin");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    })(),
  );
});
