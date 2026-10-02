type OneSignalWebSdk = {
  init(options: {
    appId: string;
    serviceWorkerPath: string;
    serviceWorkerParam: { scope: string };
    autoResubscribe: boolean;
    persistNotification: boolean;
  }): Promise<void>;
  User: {
    PushSubscription: {
      optIn(): Promise<void>;
      optOut(): Promise<void>;
      optedIn: boolean | null;
    };
  };
};

declare global {
  interface Window {
    OneSignalDeferred?: Array<(sdk: OneSignalWebSdk) => void | Promise<void>>;
  }
}

// The OneSignal App ID is public client configuration. Never put the REST API key in this file.
const ONESIGNAL_APP_ID = "05c9b808-2012-4120-ac1f-2254c95acc6b";
const ONESIGNAL_SCRIPT_SELECTOR = 'script[data-mku-onesignal="true"]';
const ONESIGNAL_SCRIPT_URL = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
const ONESIGNAL_WORKER_PATH = "push/onesignal/OneSignalSDKWorker.js";
const ONESIGNAL_WORKER_SCOPE = "/push/onesignal/";
const OPT_IN_STORAGE_KEY = "mku-pulse-onesignal-broadcasts-enabled";
const PROMPT_DISMISSED_KEY_PREFIX = "mku-pulse:onesignal-prompt-dismissed:v1:";
const PROMPT_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

let sdkPromise: Promise<OneSignalWebSdk> | null = null;

function loadOneSignal(): Promise<OneSignalWebSdk> {
  if (typeof window === "undefined")
    return Promise.reject(new Error("OneSignal requires a browser"));
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise<OneSignalWebSdk>((resolve, reject) => {
    const deferred = window.OneSignalDeferred ?? [];
    window.OneSignalDeferred = deferred;
    deferred.push(async (sdk) => {
      try {
        await sdk.init({
          appId: ONESIGNAL_APP_ID,
          serviceWorkerPath: ONESIGNAL_WORKER_PATH,
          serviceWorkerParam: { scope: ONESIGNAL_WORKER_SCOPE },
          autoResubscribe: true,
          persistNotification: true,
        });
        resolve(sdk);
      } catch (error) {
        reject(error);
      }
    });

    if (document.querySelector(ONESIGNAL_SCRIPT_SELECTOR)) return;

    const script = document.createElement("script");
    script.dataset["mkuOnesignal"] = "true";
    script.src = ONESIGNAL_SCRIPT_URL;
    script.async = true;
    script.onerror = () => {
      script.remove();
      reject(new Error("Could not load OneSignal Web SDK"));
    };
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    sdkPromise = null;
    throw error;
  });

  return sdkPromise;
}

function saveOptIn(enabled: boolean) {
  try {
    if (enabled) window.localStorage.setItem(OPT_IN_STORAGE_KEY, "true");
    else window.localStorage.removeItem(OPT_IN_STORAGE_KEY);
  } catch {
    // Push remains enabled for this browser session if storage is unavailable.
  }
}

export function isOneSignalBroadcastsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(OPT_IN_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function isOneSignalPromptSuppressed(userId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const key = `${PROMPT_DISMISSED_KEY_PREFIX}${userId}`;
    const stored = window.localStorage.getItem(key);
    if (!stored) return false;
    const dismissedAt = Number(stored);
    if (Number.isFinite(dismissedAt) && Date.now() - dismissedAt < PROMPT_COOLDOWN_MS) {
      return true;
    }
    window.localStorage.removeItem(key);
  } catch {
    // If storage is unavailable, the prompt can still be shown this session.
  }
  return false;
}

export function suppressOneSignalPrompt(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${PROMPT_DISMISSED_KEY_PREFIX}${userId}`, String(Date.now()));
  } catch {
    // The current dialog still closes if browser storage is unavailable.
  }
}

export function clearOneSignalPromptSuppression(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(`${PROMPT_DISMISSED_KEY_PREFIX}${userId}`);
  } catch {
    // Subscription state remains authoritative in the OneSignal SDK.
  }
}

/** Prepare the SDK without asking for notification permission. */
export async function prepareOneSignal(): Promise<void> {
  await loadOneSignal();
}

/** Read the actual browser/device subscription state from OneSignal. */
export async function isOneSignalPushSubscribed(): Promise<boolean | null> {
  try {
    const sdk = await loadOneSignal();
    const optedIn = sdk.User.PushSubscription.optedIn;
    if (optedIn === true) saveOptIn(true);
    return optedIn;
  } catch {
    return null;
  }
}

/** Called from a direct user gesture to opt in to campus broadcast campaigns. */
export async function enableOneSignalBroadcasts(): Promise<boolean> {
  if (
    typeof window === "undefined" ||
    !window.isSecureContext ||
    !("serviceWorker" in navigator) ||
    !("Notification" in window) ||
    Notification.permission === "denied"
  ) {
    return false;
  }

  try {
    const sdk = await loadOneSignal();
    await sdk.User.PushSubscription.optIn();
    const optedIn = sdk.User.PushSubscription.optedIn === true;
    if (optedIn) saveOptIn(true);
    return optedIn;
  } catch {
    return false;
  }
}

/** Opts out of OneSignal campaigns when the student turns the preference off. */
export async function disableOneSignalBroadcasts(): Promise<void> {
  if (typeof window === "undefined") return;
  const sdk = await loadOneSignal();
  await sdk.User.PushSubscription.optOut();
  saveOptIn(false);
}
