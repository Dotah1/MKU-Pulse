/* MKU Pulse PWA + Firebase Cloud Messaging service worker. */
const SHELL_CACHE = "mku-pulse-shell-v2";
const ASSET_CACHE = "mku-pulse-assets-v2";
const OFFLINE_REFRESH_TAG = "mku-pulse-offline-refresh";
const PERIODIC_REFRESH_TAG = "mku-pulse-periodic-refresh";
const PUBLIC_PWA_ASSETS = [
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];
const OWNED_CACHES = new Set([SHELL_CACHE, ASSET_CACHE]);

async function refreshPublicPwaAssets() {
  const cache = await caches.open(SHELL_CACHE);
  await Promise.all(
    PUBLIC_PWA_ASSETS.map(async (path) => {
      try {
        const response = await fetch(new Request(path, { cache: "no-cache" }));
        if (response.ok && response.type === "basic") await cache.put(path, response.clone());
      } catch {
        // Keep the last known-good offline shell when the network is unavailable.
      }
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await refreshPublicPwaAssets();
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("mku-pulse-") && !OWNED_CACHES.has(key))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

function isPublicStaticRequest(request, url) {
  if (request.method !== "GET" || url.origin !== self.location.origin) return false;
  if (url.pathname === "/sw.js" || url.pathname === "/firebase-messaging-sw.js") return false;
  return (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/favicon.ico" ||
    url.pathname === "/manifest.webmanifest" ||
    ["script", "style", "image", "font"].includes(request.destination)
  );
}

function isSafeStaticResponse(response) {
  if (!response || !response.ok || response.type !== "basic") return false;
  const cacheControl = response.headers.get("cache-control") || "";
  return !/\b(?:private|no-store)\b/i.test(cacheControl);
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (isSafeStaticResponse(response)) await cache.put(request, response.clone());
    return response;
  } catch {
    const offline = await caches.match("/offline.html");
    return (
      offline ||
      new Response("This resource is unavailable offline.", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      })
    );
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.mode === "navigate" && url.origin === self.location.origin) {
    // Never cache HTML: authenticated routes and user data remain network-only.
    event.respondWith(
      fetch(request).catch(async () => {
        const offline = await caches.match("/offline.html");
        return (
          offline ||
          new Response("You are offline. Reconnect and try again.", {
            status: 503,
            headers: { "content-type": "text/plain; charset=utf-8" },
          })
        );
      }),
    );
    return;
  }
  if (isPublicStaticRequest(request, url)) event.respondWith(cacheFirst(request));
});

self.addEventListener("sync", (event) => {
  if (event.tag === OFFLINE_REFRESH_TAG) event.waitUntil(refreshPublicPwaAssets());
});

self.addEventListener("periodicsync", (event) => {
  if (event.tag === PERIODIC_REFRESH_TAG) event.waitUntil(refreshPublicPwaAssets());
});

function notificationPath(notification) {
  const details = notification.data || {};
  const fcmData = details.FCM_MSG?.data || {};
  const candidate = details.url || details.link || fcmData.url || "/notifications";
  try {
    const target = new URL(candidate, self.location.origin);
    if (target.origin !== self.location.origin) return "/notifications";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/notifications";
  }
}

self.addEventListener("notificationclick", (event) => {
  const target = notificationPath(event.notification);
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        const navigated = await client.navigate(target);
        return (navigated || client).focus();
      }
      return self.clients.openWindow(target);
    })(),
  );
});

// Firebase's browser config is public; the private service-account credential stays on the server.
const firebaseParams = new URL(self.location.href).searchParams;
const firebaseConfig = {
  apiKey: firebaseParams.get("apiKey") || "",
  projectId: firebaseParams.get("projectId") || "",
  messagingSenderId: firebaseParams.get("messagingSenderId") || "",
  appId: firebaseParams.get("appId") || "",
};

if (firebaseConfig.apiKey && firebaseConfig.messagingSenderId && firebaseConfig.appId) {
  importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
  importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");
  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    // FCM displays notification-payload messages automatically in the background.
    // Show only data-only messages here to avoid duplicate device notifications.
    if (payload.notification) return;
    const data = payload.data || {};
    const title = data.title || "MKU Pulse";
    const url = data.url || "/notifications";
    let tag;
    try {
      const eventId = new URL(url, self.location.origin).searchParams.get("notification_event");
      if (eventId) tag = `mku-pulse-${eventId}`;
    } catch {
      // Keep a standard, ungrouped notification for malformed event URLs.
    }
    return self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      vibrate: [180, 80, 180],
      ...(tag ? { tag, renotify: false } : {}),
      data: { url },
    });
  });
}
