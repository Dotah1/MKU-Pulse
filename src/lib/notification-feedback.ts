const FEEDBACK_STORAGE_KEY = "mku-pulse:recent-notification-feedback:v2";
const LEGACY_FEEDBACK_STORAGE_KEY = "mku-pulse:last-notification-feedback:v1";
const FEEDBACK_DEDUPE_MS = 8_000;
const MAX_RECENT_FEEDBACK = 64;
const VIBRATION_PATTERN = [120, 60, 120];

type FeedbackRecord = { key: string; at: number; soundPlayed: boolean };

let audioContext: AudioContext | null = null;
let recentFeedback = new Map<string, FeedbackRecord>();

/** Unlock Web Audio after a real user gesture, as required by mobile browsers. */
export function installNotificationFeedbackUnlock(): () => void {
  if (typeof window === "undefined") return () => undefined;

  let unlocked = false;
  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    window.removeEventListener("pointerdown", unlock, true);
    window.removeEventListener("keydown", unlock, true);
    try {
      audioContext ??= new AudioContext();
      if (audioContext.state === "suspended") {
        void audioContext.resume().catch(() => undefined);
      }
    } catch {
      audioContext = null;
    }
  };

  window.addEventListener("pointerdown", unlock, { capture: true, once: true });
  window.addEventListener("keydown", unlock, { capture: true, once: true });
  return () => {
    window.removeEventListener("pointerdown", unlock, true);
    window.removeEventListener("keydown", unlock, true);
  };
}

/** Use the persisted event UUID so a realtime insert and FCM foreground copy alert once. */
export function notificationFeedbackKey(url: string | null | undefined, fallback: string): string {
  if (typeof window !== "undefined" && url) {
    try {
      const target = new URL(url, window.location.origin);
      const eventId = target.searchParams.get("notification_event");
      if (eventId) return eventId;
    } catch {
      // Use the notification row/message ID if the URL is malformed.
    }
  }
  return fallback.trim() || "mku-pulse-notification";
}

function readRecentFeedback(now: number): Map<string, FeedbackRecord> {
  const records = new Map(recentFeedback);
  try {
    for (const storageKey of [FEEDBACK_STORAGE_KEY, LEGACY_FEEDBACK_STORAGE_KEY]) {
      const stored = window.localStorage.getItem(storageKey);
      if (!stored) continue;
      const parsed: unknown = JSON.parse(stored);
      // Accept the previous single-record format during the storage-version transition.
      const entries = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object"
          ? [parsed]
          : [];
      for (const value of entries) {
        if (!value || typeof value !== "object") continue;
        const record = value as Partial<FeedbackRecord>;
        if (
          typeof record.key === "string" &&
          typeof record.at === "number" &&
          typeof record.soundPlayed === "boolean"
        ) {
          const current = records.get(record.key);
          if (!current || current.at < record.at) records.set(record.key, record as FeedbackRecord);
        }
      }
    }
  } catch {
    // Sound and vibration should still work if browser storage is unavailable.
  }
  pruneRecentFeedback(records, now);
  recentFeedback = records;
  return records;
}

function pruneRecentFeedback(records: Map<string, FeedbackRecord>, now: number): void {
  for (const [key, record] of records) {
    if (now - record.at >= FEEDBACK_DEDUPE_MS || now < record.at) records.delete(key);
  }
  if (records.size <= MAX_RECENT_FEEDBACK) return;
  const oldestFirst = [...records.values()].sort((left, right) => left.at - right.at);
  for (const record of oldestFirst.slice(0, records.size - MAX_RECENT_FEEDBACK)) {
    records.delete(record.key);
  }
}

function rememberFeedback(record: FeedbackRecord): void {
  recentFeedback.set(record.key, record);
  pruneRecentFeedback(recentFeedback, record.at);
  try {
    window.localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify([...recentFeedback.values()]));
  } catch {
    // Cross-event deduplication still works for the lifetime of this tab.
  }
}

/** Play a short in-app chime and haptic pulse; return true if an event chime already sounded. */
export function playNotificationFeedback(eventKey: string): boolean {
  if (
    typeof window === "undefined" ||
    document.visibilityState !== "visible" ||
    (typeof document.hasFocus === "function" && !document.hasFocus())
  ) {
    return false;
  }

  const key = eventKey.trim();
  if (!key) return false;
  const now = Date.now();
  const recent = readRecentFeedback(now);
  const prior = recent.get(key);
  if (prior) return prior.soundPlayed;

  try {
    if (typeof navigator.vibrate === "function") navigator.vibrate(VIBRATION_PATTERN);
  } catch {
    // Haptic feedback is optional and browser/device controlled.
  }

  if (!audioContext || audioContext.state !== "running") {
    rememberFeedback({ key, at: now, soundPlayed: false });
    return false;
  }
  const notes = [
    { frequency: 784, offset: 0 },
    { frequency: 988, offset: 0.11 },
  ];
  try {
    for (const note of notes) {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const startAt = audioContext.currentTime + note.offset;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(note.frequency, startAt);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.035, startAt + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.12);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.13);
    }
  } catch {
    rememberFeedback({ key, at: now, soundPlayed: false });
    return false;
  }
  rememberFeedback({ key, at: now, soundPlayed: true });
  return true;
}
