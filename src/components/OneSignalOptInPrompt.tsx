import { useEffect, useState } from "react";
import { toast } from "@/lib/toast";
import { useCampus } from "@/hooks/useCampus";
import {
  getCurrentPushToken,
  hasNativePushToken,
  hasPushConsent,
  isWebPushSupported,
  requestPushConsent,
} from "@/lib/push";
import {
  enableOneSignalBroadcasts,
  isOneSignalBroadcastsEnabled,
  isOneSignalPromptSuppressed,
  isOneSignalPushSubscribed,
  prepareOneSignal,
  suppressOneSignalPrompt,
  clearOneSignalPromptSuppression,
} from "@/lib/onesignal";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const ACTIVE_DELAY_MS = 20_000;

type PromptTargets = { app: boolean; oneSignal: boolean };
const NO_TARGETS: PromptTargets = { app: false, oneSignal: false };

export function OneSignalOptInPrompt() {
  const { user, profile } = useCampus();
  const userId = user?.id ?? null;
  const profileReady = Boolean(userId && profile?.id === userId);
  const notificationsEnabled = profileReady && profile?.notifications_enabled !== false;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [targets, setTargets] = useState<PromptTargets>(NO_TARGETS);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setOpen(false);
    setTargets(NO_TARGETS);
    if (!userId || !profileReady || !notificationsEnabled || isOneSignalPromptSuppressed(userId)) {
      return;
    }

    const nativeAvailable = hasNativePushToken();
    const webPushContextAvailable =
      window.isSecureContext &&
      "serviceWorker" in navigator &&
      "Notification" in window &&
      Notification.permission !== "denied";
    if (!nativeAvailable && !webPushContextAvailable) return;

    let cancelled = false;
    let remaining = ACTIVE_DELAY_MS;
    let startedAt = 0;
    let timer: number | null = null;

    const maybePrompt = async () => {
      if (cancelled || isOneSignalPromptSuppressed(userId)) return;

      const [oneSignalSupported, appSupported] = await Promise.all([
        webPushContextAvailable ? prepareOneSignal().catch(() => false) : false,
        nativeAvailable ? Promise.resolve(true) : isWebPushSupported(),
      ]);
      if (cancelled || document.visibilityState === "hidden" || profile?.id !== userId) {
        return;
      }

      const oneSignalSubscribed =
        oneSignalSupported && isOneSignalBroadcastsEnabled()
          ? await isOneSignalPushSubscribed()
          : false;
      const appPushReady = getCurrentPushToken(userId) !== null || hasPushConsent(userId);
      const needsOneSignal = oneSignalSupported && oneSignalSubscribed !== true;
      const needsAppPush = appSupported && !appPushReady;
      if (!needsOneSignal && !needsAppPush) return;

      setTargets({ app: needsAppPush, oneSignal: needsOneSignal });
      setOpen(true);
    };

    const pauseTimer = () => {
      if (timer === null) return;
      window.clearTimeout(timer);
      timer = null;
      remaining = Math.max(0, remaining - (Date.now() - startedAt));
    };

    const startTimer = () => {
      if (cancelled || timer !== null || document.visibilityState === "hidden") return;
      startedAt = Date.now();
      timer = window.setTimeout(() => {
        timer = null;
        remaining = 0;
        void maybePrompt();
      }, remaining);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") pauseTimer();
      else startTimer();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    startTimer();

    return () => {
      cancelled = true;
      pauseTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [userId, profileReady, profile?.id, notificationsEnabled, retryKey]);

  const decline = () => {
    if (userId) suppressOneSignalPrompt(userId);
    setOpen(false);
    setTargets(NO_TARGETS);
  };

  const dismissWithoutDecision = () => {
    if (busy) return;
    // Accidental dismissal is not consent or rejection. Do not start the
    // cooldown; the prompt will be eligible again when the app is reopened.
    setOpen(false);
    setTargets(NO_TARGETS);
    // Restart the active timer so an accidental dismissal cannot suppress the
    // prompt for the rest of the session.
    setRetryKey((value) => value + 1);
  };

  const accept = async () => {
    if (busy || !userId) return;
    setBusy(true);
    try {
      const oneSignalReady = targets.oneSignal ? await enableOneSignalBroadcasts() : false;
      const appPushReady =
        targets.app && notificationsEnabled ? await requestPushConsent(userId) : false;
      if (!oneSignalReady && !appPushReady) {
        toast.error(
          "Notifications could not be enabled. Check this device's notification permission and try again.",
        );
        return;
      }
      clearOneSignalPromptSuppression(userId);
      setOpen(false);
      setTargets(NO_TARGETS);
      if (oneSignalReady && appPushReady) {
        toast.success("This device is subscribed to MKU Pulse push alerts.");
      } else if (appPushReady) {
        toast.success("Message and activity alerts are enabled on this device.");
      } else {
        toast.success("Campus broadcast alerts are enabled on this device.");
      }
    } catch {
      toast.error("Could not enable notifications. Check your connection and device settings.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setOpen(true);
        else dismissWithoutDecision();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Get MKU Pulse campus alerts?</DialogTitle>
          <DialogDescription>
            Allow system notifications for new messages, matches, and campus activity—even when the
            app is closed. You can change your notification preferences later in Profile.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={decline}
            disabled={busy}
          >
            Not now
          </Button>
          <Button type="button" className="min-h-11" onClick={() => void accept()} disabled={busy}>
            {busy ? "Enabling…" : "Yes, allow alerts"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
