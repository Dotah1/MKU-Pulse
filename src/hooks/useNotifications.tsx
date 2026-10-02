import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCampus } from "@/hooks/useCampus";
import { isAnnouncementExpired } from "@/lib/announcement";

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  url: string | null;
  read_at: string | null;
  created_at: string;
}

/** In-app notification centre: latest notifications plus live updates. */
export function useNotifications(limit = 30) {
  const { user } = useCampus();
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
    const { data } = await supabase
      .from("notifications")
      .select("id, kind, title, body, url, read_at, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (requestId !== loadRequestId.current) return;
    setItems(
      ((data ?? []) as AppNotification[]).filter(
        (notification) =>
          notification.kind !== "announcement" || !isAnnouncementExpired(notification.url),
      ),
    );
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
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setItems((current) =>
        current.filter(
          (notification) =>
            notification.kind !== "announcement" || !isAnnouncementExpired(notification.url),
        ),
      );
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const visibleItems = itemsOwnerId === (user?.id ?? null) ? items : [];

  const markRead = useCallback(async (id: string) => {
    setItems((list) =>
      list.map((n) => (n.id === id ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n)),
    );
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
  }, []);

  const markAllRead = useCallback(async () => {
    if (!user) return;
    const now = new Date().toISOString();
    setItems((list) => list.map((n) => ({ ...n, read_at: n.read_at ?? now })));
    await supabase
      .from("notifications")
      .update({ read_at: now })
      .eq("user_id", user.id)
      .is("read_at", null);
  }, [user]);

  return {
    items: visibleItems,
    loading,
    unreadCount: visibleItems.filter((n) => !n.read_at).length,
    reload: load,
    markRead,
    markAllRead,
  };
}
