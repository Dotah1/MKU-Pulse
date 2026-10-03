import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useCampus } from "@/hooks/useCampus";
import {
  disablePush,
  enablePush,
  hasNativePushToken,
  hasPushConsent,
  PUSH_CONSENT_CHANGED_EVENT,
  removeUnconsentedNativeToken,
} from "@/lib/push";
import { installNotificationFeedbackUnlock } from "@/lib/notification-feedback";

/** Keeps a consented browser/PWA device registered for background alerts. */
export function PushNotificationsBridge() {
  const { user, profile } = useCampus();
  const userId = user?.id ?? null;
  const profileId = profile?.id ?? null;
  const notificationsEnabled = profile?.notifications_enabled !== false;
  const [consentVersion, setConsentVersion] = useState(0);

  useEffect(() => installNotificationFeedbackUnlock(), []);

  useEffect(() => {
    if (!userId) return;
    const onConsentChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string }>).detail;
      if (detail?.userId === userId) setConsentVersion((version) => version + 1);
    };
    window.addEventListener(PUSH_CONSENT_CHANGED_EVENT, onConsentChanged);
    return () => window.removeEventListener(PUSH_CONSENT_CHANGED_EVENT, onConsentChanged);
  }, [userId]);

  useEffect(() => {
    if (!userId || profileId !== userId) return;

    if (hasNativePushToken() && !hasPushConsent(userId)) {
      void removeUnconsentedNativeToken(userId);
      return;
    }
    if (!notificationsEnabled) {
      void disablePush(userId);
      return;
    }
    if (!hasPushConsent(userId)) return;

    let active = true;
    void enablePush(userId)
      .then((token) => {
        if (
          active &&
          !token &&
          consentVersion > 0 &&
          (hasNativePushToken() ||
            ("Notification" in window && Notification.permission === "granted"))
        ) {
          toast.error(
            "This device is allowed to receive alerts, but MKU Pulse could not register it. Check your connection or try again in Profile.",
          );
        }
      })
      .catch(() => {
        if (active && consentVersion > 0) {
          toast.error(
            "MKU Pulse could not register this device for push alerts. Please try again.",
          );
        }
      });

    return () => {
      active = false;
      void disablePush(userId).then((removed) => {
        if (!removed) {
          // Keep the token's original account ownership in memory; never reuse it
          // for a different signed-in account if server cleanup could not be confirmed.
          console.warn("MKU Pulse could not confirm push-token cleanup for the previous account.");
        }
      });
    };
  }, [userId, profileId, notificationsEnabled, consentVersion]);

  return null;
}
