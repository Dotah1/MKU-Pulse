import { useCallback, useEffect, useRef, useState } from "react";
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
  const [items, setItems] = useState<AppNotification[]>([]);
  const [itemsOwnerId, setItemsOwnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRequestId = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++loadRequestId.current;
    if (!user) {
      setItems([]);
      setItemsOwnerId(null);
      setLoading(false);
      return;
    }

    const liveItems: AppNotification[] = [];
    const pageSize = Math.max(NOTIFICATION_PAGE_SIZE, limit);
    for (let page = 0; page < MAX_NOTIFICATION_SCAN_PAGES && liveItems.length < limit; page += 1) {
      const offset = page * pageSize;
      const { data, error } = await supabase
        .from("notifications")
        .select("id, kind, title, body, url, read_at, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (requestId !== loadRequestId.current) return;
      if (error) {
        setLoading(false);
        return;
      }
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
    setLoading(false);
  }, [user, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`notifications-${user.id}`)
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
  }, [user, profile?.notifications_enabled, load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setItems((current) =>
        current.filter(
          (notification) =>
            notification.kind !== "announcement" || !isAnnouncementExpired(notification.url),
        ),
      );
      void load();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const visibleItems = itemsOwnerId === (user?.id ?? null) ? items : [];

  const markRead = useCallback(async (id: string) => {
    setItems((list) =>
      list.map((notification) =>
        notification.id === id
          ? { ...notification, read_at: notification.read_at ?? new Date().toISOString() }
          : notification,
      ),
    );
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
  }, []);

  const markAllRead = useCallback(async () => {
    if (!user) return;
    const now = new Date().toISOString();
    setItems((list) =>
      list.map((notification) => ({
        ...notification,
        read_at: notification.read_at ?? now,
      })),
    );
    await supabase
      .from("notifications")
      .update({ read_at: now })
      .eq("user_id", user.id)
      .is("read_at", null);
  }, [user]);

  return {
    items: visibleItems,
    loading,
    unreadCount: visibleItems.filter((notification) => !notification.read_at).length,
    reload: load,
    markRead,
    markAllRead,
  };
}
