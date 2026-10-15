// The installed app's service worker. When a page navigation fails because the
// device is offline, it shows the offline page (app/offline/route.ts) instead of
// the browser's error. components/pwa/service-worker.tsx registers it, except
// under `next dev`.
//
// It caches nothing else. Pages, signed-in or not, and every API, Clerk, Convex,
// Polar, and Sentry request go to the network without passing through here.
// `_next/static` assets are left to the browser's HTTP cache, where Next.js marks
// them immutable; the offline page needs none of them.
//
// Updates: the registration puts the deployment's ID in this script's URL
// (`/sw.js?v=…`), so every deploy installs a new worker, and the browser rechecks
// this file without its HTTP cache. The new worker caches its deploy's offline page
// and takes over open pages at once. That is safe because pages never come from the
// cache: an open page keeps the version it loaded, and the next launch or navigation
// loads the current deploy from the network.

const CACHE = "offline";
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Fetched without cookies, so the cached copy cannot depend on who is signed in.
    await cache.add(new Request(OFFLINE_URL, { credentials: "omit", cache: "reload" }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Lets navigations start while the worker boots, so it doesn't slow them down.
    await self.registration.navigationPreload?.enable();
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith((async () => {
    try {
      return (await event.preloadResponse) ?? (await fetch(event.request));
    } catch {
      // Only a network failure lands here; error responses from the server pass through.
      return (await caches.match(OFFLINE_URL)) ?? Response.error();
    }
  })());
});
