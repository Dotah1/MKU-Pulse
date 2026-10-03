import {
  getFirebaseWebConfig,
  registerDeviceToken,
  unregisterDeviceToken,
} from "@/lib/notifications.functions";
import { supabase } from "@/integrations/supabase/client";
import { registerPwaServiceWorker } from "@/lib/pwa";
import { notificationFeedbackKey, playNotificationFeedback } from "@/lib/notification-feedback";

/** Browser/APK push wiring for Firebase Cloud Messaging. */
const PUSH_CONSENT_KEY_PREFIX = "mku-pulse:push-consent:v1:";
const PUSH_TOKEN_KEY_PREFIX = "mku-pulse:registered-push-token:v1:";
export const PUSH_CONSENT_CHANGED_EVENT = "mku-pulse:push-consent-changed";

let currentToken: string | null = null;
let currentUserId: string | null = null;
let foregroundUnsubscribe: (() => void) | null = null;
let generation = 0;
let registrationInFlight: {
  userId: string;
  generation: number;
  promise: Promise<string | null>;
} | null = null;
let disableInFlight: { userId: string; promise: Promise<boolean> } | null = null;
const inMemoryPushConsent = new Set<string>();

interface NativeBridge {
  getFcmToken?: () => string | null;
  fcmToken?: string | null;
}

/** WebToAPK-style wrappers expose the native FCM token on the window object. */
function readNativeToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
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
    return (
      candidates.find((token): token is string => typeof token === "string" && token.length > 20) ??
      null
    );
  } catch {
    return null;
  }
}

function consentKey(userId: string): string {
  return `${PUSH_CONSENT_KEY_PREFIX}${userId}`;
}

function pushTokenKey(userId: string): string {
  return `${PUSH_TOKEN_KEY_PREFIX}${userId}`;
}

function storedTokenForUser(userId: string): string | null {
  try {
    return window.localStorage.getItem(pushTokenKey(userId));
  } catch {
    return null;
  }
}

function saveTokenForUser(userId: string, token: string): void {
  try {
    window.localStorage.setItem(pushTokenKey(userId), token);
  } catch {
    // The active session can still clean up its in-memory token.
  }
}

function forgetTokenForUser(userId: string, token: string): void {
  try {
    if (window.localStorage.getItem(pushTokenKey(userId)) === token) {
      window.localStorage.removeItem(pushTokenKey(userId));
    }
  } catch {
    // The authenticated server-side deletion remains authoritative.
  }
}

export function hasNativePushToken(): boolean {
  return readNativeToken() !== null;
}

/** Native-wrapper push has no browser permission prompt, so retain its explicit app consent per user. */
export function hasPushConsent(userId: string): boolean {
  if (typeof window === "undefined" || !userId) return false;
  if (!inMemoryPushConsent.has(userId)) {
    try {
      if (window.localStorage.getItem(consentKey(userId)) !== "granted") return false;
    } catch {
      return false;
    }
  }
  if (hasNativePushToken()) return true;
  return "Notification" in window && Notification.permission === "granted";
}

function dispatchConsentChange(userId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PUSH_CONSENT_CHANGED_EVENT, { detail: { userId } }));
}

export function grantPushConsent(userId: string): void {
  if (typeof window === "undefined" || !userId) return;
  inMemoryPushConsent.add(userId);
  try {
    window.localStorage.setItem(consentKey(userId), "granted");
  } catch {
    // In-memory browser permission remains authoritative for standard web push.
  }
  dispatchConsentChange(userId);
}

export function revokePushConsent(userId: string): void {
  if (typeof window === "undefined" || !userId) return;
  inMemoryPushConsent.delete(userId);
  try {
    window.localStorage.removeItem(consentKey(userId));
  } catch {
    // The caller still proceeds with server-side token removal.
  }
  dispatchConsentChange(userId);
}

/** Called only from an explicit Yes/Profile action; browser permission is never requested on mount. */
export async function requestPushConsent(userId: string): Promise<boolean> {
  if (typeof window === "undefined" || !userId) return false;
  if (readNativeToken()) {
    grantPushConsent(userId);
    return true;
  }
  if (!("Notification" in window)) return false;
  let permission = Notification.permission;
  if (permission === "default") {
    permission = await Notification.requestPermission();
  }
  if (permission !== "granted") return false;
  grantPushConsent(userId);
  return true;
}

export function getCurrentPushToken(expectedUserId?: string): string | null {
  if (expectedUserId && currentUserId !== expectedUserId) return null;
  return currentToken;
}

function isIosDevice(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandaloneApp(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function hasWebPushPrerequisites(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "Notification" in window &&
    Notification.permission !== "denied" &&
    (!isIosDevice() || isStandaloneApp())
  );
}

/** Checks real Firebase/browser support without opening the browser permission prompt. */
export async function isWebPushSupported(): Promise<boolean> {
  if (!hasWebPushPrerequisites()) return false;
  try {
    const config = await getFirebaseWebConfig();
    if (!config.configured) return false;
    const { isSupported } = await import("firebase/messaging");
    return await isSupported();
  } catch {
    return false;
  }
}

/** Recover this device's existing web token for cleanup; never asks for permission. */
async function getExistingWebPushToken(): Promise<{ token: string | null; failed: boolean }> {
  if (
    !hasWebPushPrerequisites() ||
    Notification.permission !== "granted" ||
    !navigator.serviceWorker
  ) {
    return { token: null, failed: false };
  }
  try {
    const config = await getFirebaseWebConfig();
    if (!config.configured) return { token: null, failed: false };
    const registration = await navigator.serviceWorker.getRegistration("/");
    if (!registration) return { token: null, failed: false };

    const { getApps, initializeApp } = await import("firebase/app");
    const { getMessaging, getToken, isSupported } = await import("firebase/messaging");
    if (!(await isSupported())) return { token: null, failed: false };
    const app =
      getApps().find((candidate) => candidate.options.projectId === config.projectId) ??
      initializeApp({
        apiKey: config.apiKey,
        projectId: config.projectId,
        messagingSenderId: config.messagingSenderId,
        appId: config.appId,
        authDomain: `${config.projectId}.firebaseapp.com`,
      });
    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
      vapidKey: config.vapidKey,
      serviceWorkerRegistration: registration,
    });
    return { token: token || null, failed: false };
  } catch {
    return { token: null, failed: true };
  }
}

/** Remove a legacy native registration when this account has not explicitly consented. */
export async function removeUnconsentedNativeToken(userId: string): Promise<boolean> {
  const token = readNativeToken();
  if (!token || hasPushConsent(userId)) return true;
  if (currentToken && (currentToken !== token || currentUserId !== userId)) return false;
  currentToken = token;
  currentUserId = userId;
  return disablePush(userId);
}

async function isCurrentSignedInUser(expectedUserId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.getUser();
    return !error && data.user?.id === expectedUserId;
  } catch {
    return false;
  }
}

function registrationIsCurrent(expectedUserId: string, currentGeneration: number): boolean {
  return (
    generation === currentGeneration &&
    hasPushConsent(expectedUserId) &&
    (!currentUserId || currentUserId === expectedUserId)
  );
}

async function removeTokenForUser(token: string, userId: string): Promise<boolean> {
  try {
    await unregisterDeviceToken({ data: { token, expectedUserId: userId } });
    forgetTokenForUser(userId, token);
    if (currentToken === token && currentUserId === userId) {
      currentToken = null;
      currentUserId = null;
    }
    return true;
  } catch {
    return false;
  }
}

async function persistTokenForUser(
  token: string,
  platform: "web" | "android",
  userId: string,
  currentGeneration: number,
): Promise<string | null> {
  if (!registrationIsCurrent(userId, currentGeneration) || !(await isCurrentSignedInUser(userId))) {
    return null;
  }
  if (currentToken && currentUserId !== userId) return null;

  // Keep ownership while the authenticated server request is in flight. Cleanup
  // waits for this registration and removes exactly this user's token.
  currentToken = token;
  currentUserId = userId;
  try {
    await registerDeviceToken({
      data: { token, platform, expectedUserId: userId },
    });
    saveTokenForUser(userId, token);
  } catch (error) {
    if (generation === currentGeneration && currentToken === token && currentUserId === userId) {
      currentToken = null;
      currentUserId = null;
    }
    throw error;
  }

  if (!registrationIsCurrent(userId, currentGeneration) || !(await isCurrentSignedInUser(userId))) {
    await removeTokenForUser(token, userId);
    return null;
  }
  return token;
}

async function registerPushForUser(
  userId: string,
  currentGeneration: number,
): Promise<string | null> {
  if (!registrationIsCurrent(userId, currentGeneration)) return null;
  if (!(await isCurrentSignedInUser(userId))) return null;

  const nativeToken = readNativeToken();
  if (nativeToken) {
    // A native token is accepted only after this account explicitly agreed in
    // the app prompt/Profile; profiles.notifications_enabled defaults to true
    // and is not proof of consent.
    if (!hasPushConsent(userId)) return null;
    return persistTokenForUser(nativeToken, "android", userId, currentGeneration);
  }

  if (
    !window.isSecureContext ||
    !("serviceWorker" in navigator) ||
    !("Notification" in window) ||
    Notification.permission !== "granted"
  ) {
    return null;
  }

  const config = await getFirebaseWebConfig();
  if (!config.configured || !registrationIsCurrent(userId, currentGeneration)) return null;

  const { initializeApp, getApps, getApp } = await import("firebase/app");
  const { getMessaging, getToken, onMessage, isSupported } = await import("firebase/messaging");
  if (!(await isSupported()) || !registrationIsCurrent(userId, currentGeneration)) return null;

  const app = getApps().length
    ? getApp()
    : initializeApp({
        apiKey: config.apiKey,
        projectId: config.projectId,
        messagingSenderId: config.messagingSenderId,
        appId: config.appId,
        authDomain: `${config.projectId}.firebaseapp.com`,
      });

  const registration = await registerPwaServiceWorker({
    apiKey: config.apiKey,
    projectId: config.projectId,
    messagingSenderId: config.messagingSenderId,
    appId: config.appId,
  });
  if (!registration || !registrationIsCurrent(userId, currentGeneration)) return null;

  const messaging = getMessaging(app);
  const token = await getToken(messaging, {
    vapidKey: config.vapidKey,
    serviceWorkerRegistration: registration,
  });
  if (!token || !registrationIsCurrent(userId, currentGeneration)) return null;

  const registeredToken = await persistTokenForUser(token, "web", userId, currentGeneration);
  if (!registeredToken) return null;

  foregroundUnsubscribe?.();
  foregroundUnsubscribe = onMessage(messaging, (payload) => {
    const data = payload.data ?? {};
    const message = {
      title: payload.notification?.title ?? data["title"] ?? "MKU Pulse",
      body: payload.notification?.body ?? data["body"] ?? "",
      url: data["url"] ?? "/notifications",
    };
    const eventKey = notificationFeedbackKey(
      message.url,
      payload.messageId ?? `${message.title}:${message.body}`,
    );
    const soundAlreadyPlayed = playNotificationFeedback(eventKey);
    if (Notification.permission === "granted") {
      const notificationOptions: NotificationOptions & { vibrate?: number[] } = {
        body: message.body,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        tag: `mku-pulse-${eventKey}`,
        // Use OS sound if Web Audio is blocked, but the app feedback handler
        // owns the foreground haptic so it cannot be doubled by the notification.
        silent: soundAlreadyPlayed,
        vibrate: [],
        data: { url: message.url },
      };
      void navigator.serviceWorker.ready
        .then((readyRegistration) =>
          readyRegistration.showNotification(message.title, notificationOptions),
        )
        .catch(() => undefined);
    }
  });

  return registeredToken;
}

/** The authenticated app bridge is the sole automatic registration owner. */
export async function enablePush(userId: string): Promise<string | null> {
  if (typeof window === "undefined" || !userId || !hasPushConsent(userId)) return null;

  if (disableInFlight) {
    if (disableInFlight.userId !== userId) return null;
    const removed = await disableInFlight.promise;
    if (!removed) return null;
  }
  if (currentToken) {
    if (currentUserId !== userId) return null;
    if (foregroundUnsubscribe) return currentToken;
  }
  if (registrationInFlight) {
    if (registrationInFlight.userId === userId && registrationInFlight.generation === generation) {
      return registrationInFlight.promise;
    }
    if (registrationInFlight.generation === generation) return null;
    await registrationInFlight.promise.catch(() => null);
  }
  if (currentToken && currentUserId !== userId) return null;

  const currentGeneration = generation;
  const promise = registerPushForUser(userId, currentGeneration)
    .catch(() => null)
    .finally(() => {
      if (registrationInFlight?.promise === promise) registrationInFlight = null;
    });
  registrationInFlight = { userId, generation: currentGeneration, promise };
  return promise;
}

/** Removes this account's token; false means cleanup was not confirmed and sign-out should wait. */
export function disablePush(expectedUserId: string): Promise<boolean> {
  if (!expectedUserId) return Promise.resolve(false);
  if (disableInFlight?.userId === expectedUserId) return disableInFlight.promise;

  const promise = (async () => {
    generation += 1;
    const pending = registrationInFlight;
    if (pending?.userId === expectedUserId) await pending.promise.catch(() => null);

    if (currentUserId && currentUserId !== expectedUserId) return false;
    if (!(await isCurrentSignedInUser(expectedUserId))) return false;

    const tokens = new Set<string>();
    if (currentToken && currentUserId === expectedUserId) tokens.add(currentToken);
    const storedToken = storedTokenForUser(expectedUserId);
    if (storedToken) tokens.add(storedToken);
    const nativeToken = readNativeToken();
    if (nativeToken) tokens.add(nativeToken);
    const webRecovery = nativeToken
      ? { token: null, failed: false }
      : await getExistingWebPushToken();
    if (webRecovery.token) tokens.add(webRecovery.token);

    if (!(await isCurrentSignedInUser(expectedUserId))) return false;
    for (const token of tokens) {
      if (!(await removeTokenForUser(token, expectedUserId))) return false;
    }
    if (webRecovery.failed) return false;
    foregroundUnsubscribe?.();
    foregroundUnsubscribe = null;
    return true;
  })().finally(() => {
    if (disableInFlight?.promise === promise) disableInFlight = null;
  });
  disableInFlight = { userId: expectedUserId, promise };
  return promise;
}
