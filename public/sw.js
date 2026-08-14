/* Retired service worker. Campus Connect now uses /firebase-messaging-sw.js for
   Firebase Cloud Messaging, so this worker removes itself for returning users. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      try {
        await self.clients.claim();
      } finally {
        await self.registration.unregister();
      }
    })(),
  ),
);
