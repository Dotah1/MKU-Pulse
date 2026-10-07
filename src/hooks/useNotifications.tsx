import { useCallback, useEffect, useId, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCampus } from "@/hooks/useCampus";
import { isAnnouncementExpired } from "@/lib/announcement";
import { notificationFeedbackKey, playNotificationFeedback } from "@/lib/notification-feedback";

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  url: string | null;
  read_at: string | null;
  created_at: string;
}

const NOTIFICATION_PAGE_SIZE = 50;
const MAX_NOTIFICATION_SCAN_PAGES = 10;

/** In-app notification centre: latest live notifications plus realtime updates. */
export function useNotifications(limit = 30) {
  const { user, profile } = useCampus();
  const instanceId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [items, setItems] = useState<AppNotification[]>([]);
  const [itemsOwnerId, setItemsOwnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadRequestId = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++loadRequestId.current;
    if (!user) {
      setItems([]);
      setItemsOwnerId(null);
      setError(null);
      setLoading(false);
      return;
    }

    try {
      const liveItems: AppNotification[] = [];
      const pageSize = Math.max(NOTIFICATION_PAGE_SIZE, limit);
      for (
        let page = 0;
        page < MAX_NOTIFICATION_SCAN_PAGES && liveItems.length < limit;
        page += 1
      ) {
        const offset = page * pageSize;
        const { data, error: loadError } = await supabase
          .from("notifications")
          .select("id, kind, title, body, url, read_at, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(offset, offset + pageSize - 1);

        if (requestId !== loadRequestId.current) return;
        if (loadError) throw loadError;
        const pageItems = (data ?? []) as AppNotification[];
        liveItems.push(
          ...pageItems.filter(
            (notification) =>
              notification.kind !== "announcement" || !isAnnouncementExpired(notification.url),
          ),
        );
        if (pageItems.length < pageSize) break;
      }

      if (requestId !== loadRequestId.current) return;
      setItems(liveItems.slice(0, limit));
      setItemsOwnerId(user.id);
      setError(null);
    } catch (loadError) {
      if (requestId !== loadRequestId.current) return;
      console.error("Could not load notifications", loadError);
      setError("Notifications couldn’t load. Please try again.");
    } finally {
      if (requestId === loadRequestId.current) setLoading(false);
    }
  }, [user, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`notifications-${user.id}-${instanceId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const incoming = payload.new as Partial<AppNotification> & { user_id?: string };
            const occurredAt = Date.parse(incoming.created_at ?? "");
            if (
              incoming.user_id === user.id &&
              profile?.notifications_enabled !== false &&
              incoming.id &&
              Number.isFinite(occurredAt) &&
              Date.now() - occurredAt >= 0 &&
              Date.now() - occurredAt < 120_000 &&
              (incoming.kind !== "announcement" || !isAnnouncementExpired(incoming.url ?? null))
            ) {
              playNotificationFeedback(notificationFeedbackKey(incoming.url, incoming.id));
            }
          }
          void load();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, profile?.notifications_enabled, load, instanceId]);

  useEffect(() => {
    if (!user) return;
    let timer: number | null = null;
    const refresh = () => {
      setItems((current) =>
        current.filter(
          (notification) =>
            notification.kind !== "announcement" || !isAnnouncementExpired(notification.url),
        ),
      );
      if (document.visibilityState === "visible") void load();
    };
    const schedule = () => {
      if (timer !== null) window.clearInterval(timer);
      timer =
        document.visibilityState === "visible" ? window.setInterval(refresh, 5 * 60_000) : null;
    };
    document.addEventListener("visibilitychange", schedule);
    window.addEventListener("focus", refresh);
    schedule();
    return () => {
      if (timer !== null) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", schedule);
      window.removeEventListener("focus", refresh);
    };
  }, [load, user]);

  const visibleItems = itemsOwnerId === (user?.id ?? null) ? items : [];

  const markRead = useCallback(
    async (id: string) => {
      if (!user) return;
      const now = new Date().toISOString();
      setItems((list) =>
        list.map((notification) =>
          notification.id === id
            ? { ...notification, read_at: notification.read_at ?? now }
            : notification,
        ),
      );
      const { error: updateError } = await supabase
        .from("notifications")
        .update({ read_at: now })
        .eq("id", id)
        .eq("user_id", user.id)
        .is("read_at", null);
      if (updateError) {
        console.error("Could not mark notification as read", updateError);
        await load();
      }
    },
    [user, load],
  );

  const markAllRead = useCallback(async () => {
    if (!user) return;
    const now = new Date().toISOString();
    setItems((list) =>
      list.map((notification) => ({
        ...notification,
        read_at: notification.read_at ?? now,
      })),
    );
    const { error: updateError } = await supabase
      .from("notifications")
      .update({ read_at: now })
      .eq("user_id", user.id)
      .is("read_at", null);
    if (updateError) {
      console.error("Could not mark all notifications as read", updateError);
      await load();
    }
  }, [user, load]);

  return {
    items: visibleItems,
    loading,
    error,
    unreadCount: visibleItems.filter((notification) => !notification.read_at).length,
    reload: load,
    markRead,
    markAllRead,
  };
}
