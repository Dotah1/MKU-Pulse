import {
  getFirebaseWebConfig,
  registerDeviceToken,
  unregisterDeviceToken,
} from "@/lib/notifications.functions";

/**
 * Browser/APK push wiring for Firebase Cloud Messaging.
 * All Firebase imports are dynamic so nothing touches the SSR bundle.
 */

const SW_PATH = "/firebase-messaging-sw.js";
let currentToken: string | null = null;

interface NativeBridge {
  getFcmToken?: () => string | null;
  fcmToken?: string | null;
}

/** WebToAPK-style wrappers expose the native FCM token on the window object. */
function readNativeToken(): string | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown> & {
    WebToApk?: NativeBridge;
    Android?: NativeBridge;
    AndroidBridge?: NativeBridge;
  };
  const candidates = [
    typeof w["fcmToken"] === "string" ? (w["fcmToken"] as string) : null,
    typeof w["FCM_TOKEN"] === "string" ? (w["FCM_TOKEN"] as string) : null,
    w.WebToApk?.fcmToken ??
      (typeof w.WebToApk?.getFcmToken === "function" ? w.WebToApk.getFcmToken() : null),
    w.Android?.fcmToken ??
      (typeof w.Android?.getFcmToken === "function" ? w.Android.getFcmToken() : null),
    w.AndroidBridge?.fcmToken ??
      (typeof w.AndroidBridge?.getFcmToken === "function" ? w.AndroidBridge.getFcmToken() : null),
  ];
  return candidates.find((t): t is string => typeof t === "string" && t.length > 20) ?? null;
}

export function getCurrentPushToken(): string | null {
  return currentToken;
}

export interface ForegroundMessage {
  title: string;
  body: string;
  url: string;
}

/**
 * Requests notification permission, obtains an FCM token and stores it for the
 * signed-in user. Returns null when push is unavailable or not configured.
 */
export async function enablePush(
  onForeground?: (message: ForegroundMessage) => void,
): Promise<string | null> {
  if (typeof window === "undefined") return null;

  // Installed APK: the native layer already owns the FCM token.
  const nativeToken = readNativeToken();
  if (nativeToken) {
    currentToken = nativeToken;
    await registerDeviceToken({ data: { token: nativeToken, platform: "android" } });
    return nativeToken;
  }

  if (!("serviceWorker" in navigator) || !("Notification" in window)) return null;

  const config = await getFirebaseWebConfig();
  if (!config.configured) return null;

  if (Notification.permission === "default") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return null;
  }
  if (Notification.permission !== "granted") return null;

  const { initializeApp, getApps, getApp } = await import("firebase/app");
  const { getMessaging, getToken, onMessage, isSupported } = await import("firebase/messaging");
  if (!(await isSupported())) return null;

  const app = getApps().length
    ? getApp()
    : initializeApp({
        apiKey: config.apiKey,
        projectId: config.projectId,
        messagingSenderId: config.messagingSenderId,
        appId: config.appId,
        authDomain: `${config.projectId}.firebaseapp.com`,
      });

  const query = new URLSearchParams({
    apiKey: config.apiKey,
    projectId: config.projectId,
    messagingSenderId: config.messagingSenderId,
    appId: config.appId,
  });
  const registration = await navigator.serviceWorker.register(`${SW_PATH}?${query.toString()}`);

  const messaging = getMessaging(app);
  const token = await getToken(messaging, {
    vapidKey: config.vapidKey,
    serviceWorkerRegistration: registration,
  });
  if (!token) return null;

  currentToken = token;
  await registerDeviceToken({ data: { token, platform: "web" } });

  if (onForeground) {
    onMessage(messaging, (payload) => {
      const data = payload.data ?? {};
      onForeground({
        title: payload.notification?.title ?? data["title"] ?? "MKU Pulse",
        body: payload.notification?.body ?? data["body"] ?? "",
        url: data["url"] ?? "/notifications",
      });
    });
  }

  return token;
}

/** Drops the current device token (used on sign-out / preference off). */
export async function disablePush(): Promise<void> {
  const token = currentToken;
  currentToken = null;
  if (token) {
    try {
      await unregisterDeviceToken({ data: { token } });
    } catch {
      /* nothing to clean up */
    }
  }
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    registrations
      .filter((r) => r.active?.scriptURL.includes("firebase-messaging-sw.js"))
      .map((r) => r.unregister()),
  );
}
