import { notifyUser } from "@/lib/notifications.functions";

/**
 * Fire-and-forget notification: saves an in-app notification for the
 * recipient(s) and pushes it to their devices via FCM. Never throws, so a
 * failed push can't break the user action that triggered it.
 */
export async function notify(input: {
  recipientIds: string[] | string;
  title: string;
  body?: string;
  url?: string;
  kind?: string;
  eventId?: string;
}): Promise<void> {
  try {
    await notifyUser({ data: input });
  } catch (error) {
    console.error("Notification failed", error);
  }
}
