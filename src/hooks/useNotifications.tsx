import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCampus } from "@/hooks/useCampus";

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
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) {
      setItems([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("notifications")
      .select("id, kind, title, body, url, read_at, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit);
    setItems((data ?? []) as AppNotification[]);
    setLoading(false);
  }, [user?.id, limit]);

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
  }, [user?.id, load]);

  const markRead = useCallback(
    async (id: string) => {
      setItems((list) =>
        list.map((n) => (n.id === id ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n)),
      );
      await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
    },
    [],
  );

  const markAllRead = useCallback(async () => {
    if (!user) return;
    const now = new Date().toISOString();
    setItems((list) => list.map((n) => ({ ...n, read_at: n.read_at ?? now })));
    await supabase
      .from("notifications")
      .update({ read_at: now })
      .eq("user_id", user.id)
      .is("read_at", null);
  }, [user?.id]);

  return {
    items,
    loading,
    unreadCount: items.filter((n) => !n.read_at).length,
    reload: load,
    markRead,
    markAllRead,
  };
}
