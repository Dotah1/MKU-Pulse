type OneSignalWebSdk = {
  setConsentRequired(required: boolean): void;
  setConsentGiven(given: boolean): void | Promise<void>;
  init(options: {
    appId: string;
    serviceWorkerPath: string;
    serviceWorkerParam: { scope: string };
    autoResubscribe: boolean;
    persistNotification: boolean;
  }): Promise<void>;
  Notifications: {
    isPushSupported(): boolean;
  };
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

function supportsOneSignalPush(sdk: OneSignalWebSdk): boolean {
  try {
    return sdk.Notifications.isPushSupported() && (!isIosDevice() || isStandaloneApp());
  } catch {
    return false;
  }
}

function loadOneSignal(): Promise<OneSignalWebSdk> {
  if (typeof window === "undefined")
    return Promise.reject(new Error("OneSignal requires a browser"));
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise<OneSignalWebSdk>((resolve, reject) => {
    const deferred = window.OneSignalDeferred ?? [];
    window.OneSignalDeferred = deferred;
    deferred.push(async (sdk) => {
      try {
        // This must run before init so OneSignal cannot collect data or create
        // a subscription until the student explicitly grants consent.
        sdk.setConsentRequired(true);
        await sdk.init({
          appId: ONESIGNAL_APP_ID,
          serviceWorkerPath: ONESIGNAL_WORKER_PATH,
          serviceWorkerParam: { scope: ONESIGNAL_WORKER_SCOPE },
          autoResubscribe: true,
          persistNotification: true,
        });
        if (isOneSignalBroadcastsEnabled()) await sdk.setConsentGiven(true);
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

function saveOptIn(enabled: boolean): void {
  try {
    if (enabled) window.localStorage.setItem(OPT_IN_STORAGE_KEY, "true");
    else window.localStorage.removeItem(OPT_IN_STORAGE_KEY);
  } catch {
    // The SDK subscription state remains authoritative for the current session.
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

/** Prepare the SDK behind OneSignal's required consent gate without asking permission. */
export async function prepareOneSignal(): Promise<boolean> {
  return supportsOneSignalPush(await loadOneSignal());
}

/** Read the actual browser/device subscription state from OneSignal. */
export async function isOneSignalPushSubscribed(): Promise<boolean | null> {
  try {
    const sdk = await loadOneSignal();
    if (!supportsOneSignalPush(sdk)) return null;
    return sdk.User.PushSubscription.optedIn;
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

  let sdk: OneSignalWebSdk | null = null;
  try {
    sdk = await loadOneSignal();
    if (!supportsOneSignalPush(sdk)) return false;
    await sdk.setConsentGiven(true);
    await sdk.User.PushSubscription.optIn();
    const optedIn = sdk.User.PushSubscription.optedIn === true;
    if (optedIn) {
      saveOptIn(true);
      return true;
    }
  } catch {
    // Revoke the temporary collection consent if subscription creation failed.
  }
  if (sdk) {
    try {
      await sdk.setConsentGiven(false);
    } catch {
      // The failed subscription remains blocked by the consent gate.
    }
  }
  saveOptIn(false);
  return false;
}

/** Opts out of OneSignal campaigns and suspends SDK collection until renewed consent. */
export async function disableOneSignalBroadcasts(): Promise<void> {
  if (typeof window === "undefined") return;
  const sdk = await loadOneSignal();
  await sdk.User.PushSubscription.optOut();
  await sdk.setConsentGiven(false);
  saveOptIn(false);
}
