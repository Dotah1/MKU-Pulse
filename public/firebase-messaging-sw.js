/* Firebase Cloud Messaging service worker for Campus Connect.
   The page registers this worker with its Firebase config in the query string,
   so no keys are hardcoded here. */
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

const params = new URL(self.location.href).searchParams;
const config = {
  apiKey: params.get("apiKey") || "",
  projectId: params.get("projectId") || "",
  messagingSenderId: params.get("messagingSenderId") || "",
  appId: params.get("appId") || "",
};

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

if (config.apiKey && config.messagingSenderId && config.appId) {
  firebase.initializeApp(config);
  const messaging = firebase.messaging();

  // Fires for data-only messages while the app is in the background.
  messaging.onBackgroundMessage((payload) => {
    const data = payload.data || {};
    const title = (payload.notification && payload.notification.title) || data.title || "Campus Connect";
    const body = (payload.notification && payload.notification.body) || data.body || "";
    self.registration.showNotification(title, {
      body,
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      tag: data.kind || "campus-connect",
      data: { url: data.url || "/notifications" },
    });
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/notifications";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
