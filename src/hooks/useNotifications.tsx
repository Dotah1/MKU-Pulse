import { useCallback, useEffect, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCampus } from "@/hooks/useCampus";
import { isAnnouncementExpired } from "@/lib/announcement";
import { notificationFeedbackKey, playNotificationFeedback } from "@/lib/notification-feedback";

interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  url: string | null;
  read_at: string | null;
  created_at: string;
}

interface NotificationSnapshot {
  items: AppNotification[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMoreError: string | null;
  error: string | null;
}

const NOTIFICATION_PAGE_SIZE = 50;
const MAX_SHARED_ITEMS = 100;
const REFRESH_INTERVAL_MS = 5 * 60_000;

const EMPTY_SNAPSHOT: NotificationSnapshot = {
  items: [],
  loading: false,
  loadingMore: false,
  hasMore: false,
  loadMoreError: null,
  error: null,
};
const EMPTY_SUBSCRIBE = () => () => undefined;

class NotificationStore {
  readonly userId: string;
  private snapshot: NotificationSnapshot = {
    items: [],
    loading: true,
    loadingMore: false,
    hasMore: false,
    loadMoreError: null,
    error: null,
  };
  private listeners = new Set<() => void>();
  private channel: ReturnType<typeof supabase.channel> | null = null;
  private timer: number | null = null;
  private requestId = 0;
  private loadMoreRequestId = 0;
  private started = false;
  private notificationsEnabled = true;

  constructor(userId: string) {
    this.userId = userId;
  }

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  };

  setNotificationsEnabled(enabled: boolean) {
    this.notificationsEnabled = enabled;
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.channel = supabase
      .channel(`notifications-${this.userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${this.userId}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const incoming = payload.new as Partial<AppNotification> & { user_id?: string };
            const occurredAt = Date.parse(incoming.created_at ?? "");
            if (
              incoming.user_id === this.userId &&
              this.notificationsEnabled &&
              incoming.id &&
              Number.isFinite(occurredAt) &&
              Date.now() - occurredAt >= 0 &&
              Date.now() - occurredAt < 120_000 &&
              (incoming.kind !== "announcement" || !isAnnouncementExpired(incoming.url ?? null))
            ) {
              playNotificationFeedback(notificationFeedbackKey(incoming.url, incoming.id));
            }
            this.upsertNotification(incoming);
            return;
          }

          if (payload.eventType === "UPDATE") {
            const incoming = payload.new as Partial<AppNotification>;
            if (!incoming.id) return;
            this.update({
              items: this.snapshot.items.map((item) =>
                item.id === incoming.id ? { ...item, ...incoming } : item,
              ),
            });
            this.removeExpiredAnnouncements();
            return;
          }

          if (payload.eventType === "DELETE") {
            const id = (payload.old as Partial<AppNotification>).id;
            if (id) this.update({ items: this.snapshot.items.filter((item) => item.id !== id) });
          }
        },
      )
      .subscribe();

    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    window.addEventListener("focus", this.handleFocus);
    this.scheduleTimer();
    void this.load();
  }

  async load() {
    this.start();
    const requestId = ++this.requestId;
    const hasItems = this.snapshot.items.length > 0;
    this.update({ loading: !hasItems, error: null });

    try {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, kind, title, body, url, read_at, created_at")
        .eq("user_id", this.userId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(NOTIFICATION_PAGE_SIZE);

      if (requestId !== this.requestId) return;
      if (error) throw error;
      const pageItems = ((data ?? []) as AppNotification[]).filter(
        (notification) =>
          notification.kind !== "announcement" || !isAnnouncementExpired(notification.url),
      );
      const merged = new Map(this.snapshot.items.map((item) => [item.id, item]));
      for (const item of pageItems) merged.set(item.id, item);
      const items = [...merged.values()]
        .sort(
          (left, right) =>
            right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id),
        )
        .slice(0, MAX_SHARED_ITEMS);
      this.update({
        items,
        hasMore: (data?.length ?? 0) === NOTIFICATION_PAGE_SIZE && items.length < MAX_SHARED_ITEMS,
        loading: false,
        error: null,
      });
    } catch (loadError) {
      if (requestId !== this.requestId) return;
      console.error("Could not load notifications", loadError);
      this.update({ loading: false, error: "Notifications couldn’t load. Please try again." });
    }
  }

  async loadMore() {
    this.start();
    if (this.snapshot.loadingMore || !this.snapshot.hasMore) return;
    const cursor = this.snapshot.items.at(-1);
    if (!cursor) return;

    const requestId = ++this.loadMoreRequestId;
    this.update({ loadingMore: true, loadMoreError: null });
    try {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, kind, title, body, url, read_at, created_at")
        .eq("user_id", this.userId)
        .or(
          `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
        )
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(NOTIFICATION_PAGE_SIZE);
      if (requestId !== this.loadMoreRequestId) return;
      if (error) throw error;

      const pageItems = ((data ?? []) as AppNotification[]).filter(
        (notification) =>
          notification.kind !== "announcement" || !isAnnouncementExpired(notification.url),
      );
      const merged = new Map(this.snapshot.items.map((item) => [item.id, item]));
      for (const item of pageItems) merged.set(item.id, item);
      const items = [...merged.values()]
        .sort(
          (left, right) =>
            right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id),
        )
        .slice(0, MAX_SHARED_ITEMS);
      this.update({
        items,
        hasMore: (data?.length ?? 0) === NOTIFICATION_PAGE_SIZE && items.length < MAX_SHARED_ITEMS,
        loadMoreError: null,
      });
    } catch (loadError) {
      if (requestId !== this.loadMoreRequestId) return;
      console.error("Could not load older notifications", loadError);
      this.update({ loadMoreError: "Older notifications couldn’t load. Please try again." });
    } finally {
      if (requestId === this.loadMoreRequestId) this.update({ loadingMore: false });
    }
  }

  async markRead(id: string) {
    this.start();
    const now = new Date().toISOString();
    this.update({
      items: this.snapshot.items.map((notification) =>
        notification.id === id
          ? { ...notification, read_at: notification.read_at ?? now }
          : notification,
      ),
    });
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: now })
      .eq("id", id)
      .eq("user_id", this.userId)
      .is("read_at", null);
    if (error) {
      console.error("Could not mark notification as read", error);
      await this.load();
    }
  }

  async markAllRead() {
    this.start();
    const now = new Date().toISOString();
    this.update({
      items: this.snapshot.items.map((notification) => ({
        ...notification,
        read_at: notification.read_at ?? now,
      })),
    });
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: now })
      .eq("user_id", this.userId)
      .is("read_at", null);
    if (error) {
      console.error("Could not mark all notifications as read", error);
      await this.load();
    }
  }

  private update(patch: Partial<NotificationSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private upsertNotification(incoming: Partial<AppNotification> & { user_id?: string }) {
    if (
      incoming.user_id !== this.userId ||
      !incoming.id ||
      typeof incoming.kind !== "string" ||
      typeof incoming.title !== "string" ||
      typeof incoming.body !== "string" ||
      typeof incoming.created_at !== "string"
    ) {
      return;
    }
    if (incoming.kind === "announcement" && isAnnouncementExpired(incoming.url ?? null)) return;
    const merged = new Map(this.snapshot.items.map((item) => [item.id, item]));
    merged.set(incoming.id, incoming as AppNotification);
    const items = [...merged.values()]
      .sort(
        (left, right) =>
          right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id),
      )
      .slice(0, MAX_SHARED_ITEMS);
    this.update({ items });
  }

  private scheduleTimer() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer =
      document.visibilityState === "visible"
        ? window.setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS)
        : null;
  }

  private refresh = async () => {
    this.removeExpiredAnnouncements();
    if (document.visibilityState === "visible") await this.load();
  };

  private handleVisibilityChange = () => {
    this.scheduleTimer();
    if (document.visibilityState === "visible") void this.load();
  };

  private handleFocus = () => {
    void this.refresh();
  };

  private removeExpiredAnnouncements() {
    const filtered = this.snapshot.items.filter(
      (notification) =>
        notification.kind !== "announcement" || !isAnnouncementExpired(notification.url),
    );
    if (filtered.length !== this.snapshot.items.length) this.update({ items: filtered });
  }

  private stop() {
    if (!this.started) return;
    this.started = false;
    this.requestId += 1;
    this.loadMoreRequestId += 1;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    window.removeEventListener("focus", this.handleFocus);
    if (this.channel) void supabase.removeChannel(this.channel);
    this.channel = null;
  }
}

const stores = new Map<string, NotificationStore>();

function getStore(userId: string) {
  let store = stores.get(userId);
  if (!store) {
    store = new NotificationStore(userId);
    stores.set(userId, store);
  }
  return store;
}

/** In-app notification centre backed by one shared store per signed-in user. */
export function useNotifications(limit = 30) {
  const { user, profile } = useCampus();
  const store = user ? getStore(user.id) : null;
  const snapshot = useSyncExternalStore(
    store?.subscribe ?? EMPTY_SUBSCRIBE,
    store?.getSnapshot ?? (() => EMPTY_SNAPSHOT),
    () => EMPTY_SNAPSHOT,
  );

  useEffect(() => {
    if (!store) return;
    store.setNotificationsEnabled(profile?.notifications_enabled !== false);
    store.start();
  }, [profile?.notifications_enabled, store]);

  const reload = useCallback(() => {
    if (store) return store.load();
    return Promise.resolve();
  }, [store]);
  const loadMore = useCallback(() => store?.loadMore() ?? Promise.resolve(), [store]);
  const markRead = useCallback((id: string) => store?.markRead(id) ?? Promise.resolve(), [store]);
  const markAllRead = useCallback(() => store?.markAllRead() ?? Promise.resolve(), [store]);
  const items = snapshot.items.slice(0, limit);

  return {
    items,
    loading: snapshot.loading,
    loadingMore: snapshot.loadingMore,
    hasMore: snapshot.hasMore,
    loadMoreError: snapshot.loadMoreError,
    error: snapshot.error,
    unreadCount: items.filter((notification) => !notification.read_at).length,
    reload,
    loadMore,
    markRead,
    markAllRead,
  };
}

export type { AppNotification, NotificationSnapshot };
