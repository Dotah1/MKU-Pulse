export interface FirebaseWorkerConfig {
  apiKey: string;
  projectId: string;
  messagingSenderId: string;
  appId: string;
}

interface SyncCapableRegistration extends ServiceWorkerRegistration {
  sync?: { register(tag: string): Promise<void> };
  periodicSync?: {
    register(tag: string, options: { minInterval: number }): Promise<void>;
  };
}

const OFFLINE_REFRESH_TAG = "mku-pulse-offline-refresh";
const PERIODIC_REFRESH_TAG = "mku-pulse-periodic-refresh";
const periodicRefreshMs = 24 * 60 * 60 * 1000;
const offlineListeners = new WeakSet<ServiceWorkerRegistration>();
let registrationQueue: Promise<unknown> = Promise.resolve();
let activeRegistration: ServiceWorkerRegistration | null = null;
let activeConfigKey: string | null = null;

function registerOfflineRefresh(registration: ServiceWorkerRegistration) {
  const sync = (registration as SyncCapableRegistration).sync;
  if (!sync || offlineListeners.has(registration)) return;

  offlineListeners.add(registration);
  const queueRefresh = () => {
    void sync.register(OFFLINE_REFRESH_TAG).catch(() => undefined);
  };
  window.addEventListener("offline", queueRefresh, { passive: true });
  if (!navigator.onLine) queueRefresh();
}

async function registerPeriodicRefresh(registration: ServiceWorkerRegistration) {
  const periodicSync = (registration as SyncCapableRegistration).periodicSync;
  if (!periodicSync || !navigator.permissions?.query) return;

  try {
    const permission = await navigator.permissions.query({
      name: "periodic-background-sync",
    } as unknown as PermissionDescriptor);
    if (permission.state === "granted") {
      await periodicSync.register(PERIODIC_REFRESH_TAG, { minInterval: periodicRefreshMs });
    }
  } catch {
    // This API is optional and permission-, browser-, and device-controlled.
  }
}

/** Register the root-scope PWA worker. Firebase web config is public and is only
 * appended when push is explicitly being enabled; no server credentials go here. */
export async function registerPwaServiceWorker(
  firebaseConfig?: FirebaseWorkerConfig,
): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !window.isSecureContext || !("serviceWorker" in navigator)) {
    return null;
  }

  const configKey = firebaseConfig ? JSON.stringify(firebaseConfig) : "base";
  const register = async (): Promise<ServiceWorkerRegistration | null> => {
    // A later base registration must never downgrade the worker that FCM configured.
    if (activeRegistration && (!firebaseConfig || configKey === activeConfigKey)) {
      return activeRegistration;
    }
    try {
      if (!firebaseConfig && !activeRegistration) {
        const existing = await navigator.serviceWorker.getRegistration("/");
        const scriptUrl = existing?.active?.scriptURL;
        if (existing && scriptUrl) {
          const existingUrl = new URL(scriptUrl);
          const isConfiguredWorker =
            existingUrl.origin === window.location.origin &&
            ((existingUrl.pathname === "/sw.js" && Boolean(existingUrl.search)) ||
              existingUrl.pathname === "/firebase-messaging-sw.js");
          if (isConfiguredWorker) {
            activeRegistration = existing;
            activeConfigKey = existingUrl.search || "existing-fcm-worker";
            registerOfflineRefresh(existing);
            void registerPeriodicRefresh(existing);
            void existing.update().catch(() => undefined);
            return existing;
          }
        }
      }
      const scriptUrl = new URL("/sw.js", window.location.origin);
      if (firebaseConfig) {
        scriptUrl.search = new URLSearchParams({
          apiKey: firebaseConfig.apiKey,
          projectId: firebaseConfig.projectId,
          messagingSenderId: firebaseConfig.messagingSenderId,
          appId: firebaseConfig.appId,
        }).toString();
      }
      const registration = await navigator.serviceWorker.register(scriptUrl.toString(), {
        scope: "/",
        updateViaCache: "none",
      });
      activeRegistration = registration;
      activeConfigKey = configKey;
      registerOfflineRefresh(registration);
      void registerPeriodicRefresh(registration);
      return registration;
    } catch {
      return null;
    }
  };

  const result = registrationQueue.then(register, register);
  registrationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
