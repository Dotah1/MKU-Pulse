import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useCampus } from "@/hooks/useCampus";
import {
  enableOneSignalBroadcasts,
  isOneSignalPushSubscribed,
  isOneSignalPromptSuppressed,
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

const ACTIVE_DELAY_MS = 60_000;
export function OneSignalOptInPrompt() {
  const { user } = useCampus();
  const userId = user?.id ?? null;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setOpen(false);
    if (!userId) return;

    if (
      !window.isSecureContext ||
      !("serviceWorker" in navigator) ||
      !("Notification" in window) ||
      Notification.permission === "denied" ||
      isOneSignalPromptSuppressed(userId)
    ) {
      return;
    }

    let cancelled = false;
    let remaining = ACTIVE_DELAY_MS;
    let startedAt = 0;
    let timer: number | null = null;

    const maybePrompt = async () => {
      if (cancelled || isOneSignalPromptSuppressed(userId)) return;
      try {
        await prepareOneSignal();
      } catch {
        return;
      }
      const subscribed = await isOneSignalPushSubscribed();
      if (
        cancelled ||
        subscribed !== false ||
        document.visibilityState === "hidden" ||
        Notification.permission === "denied"
      ) {
        return;
      }
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
  }, [userId]);

  const decline = () => {
    if (userId) suppressOneSignalPrompt(userId);
    setOpen(false);
  };

  const accept = async () => {
    if (busy) return;
    setBusy(true);
    const subscribed = await enableOneSignalBroadcasts();
    setBusy(false);
    if (!subscribed) {
      toast.error(
        "Notifications could not be enabled. Check your browser permission settings and try again.",
      );
      return;
    }
    if (userId) {
      clearOneSignalPromptSuppression(userId);
    }
    setOpen(false);
    toast.success("This device is subscribed to MKU Pulse campus alerts.");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setOpen(true);
        else if (!busy) decline();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Get MKU Pulse campus alerts?</DialogTitle>
          <DialogDescription>
            Subscribe this device to campus broadcasts and important updates. You can change your
            choice later in Profile preferences.
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
            No thanks
          </Button>
          <Button type="button" className="min-h-11" onClick={() => void accept()} disabled={busy}>
            {busy ? "Enabling…" : "Yes, allow alerts"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
