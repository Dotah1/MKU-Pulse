import { createFileRoute } from "@tanstack/react-router";
import { BellOff, Loader2 } from "lucide-react";
import { useNotifications } from "@/hooks/useNotifications";
import { Button } from "@/components/ui/button";
import { NotificationItemLink } from "@/components/NotificationItemLink";
import { timeAgo } from "@/lib/campus";

export const Route = createFileRoute("/_authenticated/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — MKU Pulse" },
      {
        name: "description",
        content: "Every message, match, mentorship and payment update from MKU Pulse in one place.",
      },
      { property: "og:title", content: "Notifications — MKU Pulse" },
      { property: "og:description", content: "Your MKU Pulse notification centre." },
    ],
  }),
  component: NotificationsPage,
});

function NotificationsPage() {
  const {
    items,
    loading,
    error,
    unreadCount,
    markRead,
    markAllRead,
    reload,
    loadMore,
    hasMore,
    loadingMore,
    loadMoreError,
  } = useNotifications(100);

  return (
    <div className="space-y-4">
      <header className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-2xl font-bold">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            {unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up"}
          </p>
        </div>
        {unreadCount > 0 && (
          <Button
            variant="outline"
            className="min-h-11 sm:ml-auto"
            onClick={() => void markAllRead()}
          >
            Mark all as read
          </Button>
        )}
      </header>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div role="alert" className="rounded-2xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" className="mt-4 min-h-11" onClick={() => void reload()}>
            Try again
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <BellOff className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 font-display font-semibold">No notifications yet</p>
          <p className="text-sm text-muted-foreground">
            Messages, matches, mentorship and payment updates will show up here.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {items.map((notification) => (
            <li key={notification.id} className={notification.read_at ? "" : "bg-primary/5"}>
              <NotificationItemLink
                notification={notification}
                markRead={markRead}
                className="block px-4 py-4 hover:bg-secondary"
              >
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 break-words [overflow-wrap:anywhere] font-medium">
                    {notification.title}
                  </p>
                  {!notification.read_at && (
                    <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                  )}
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {timeAgo(notification.created_at)}
                  </span>
                </div>
                {notification.body && (
                  <p className="mt-1 break-words [overflow-wrap:anywhere] text-sm text-muted-foreground">
                    {notification.body}
                  </p>
                )}
              </NotificationItemLink>
            </li>
          ))}
        </ul>
      )}
      {!loading && !error && hasMore && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            className="min-h-11"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? "Loading older notifications…" : "Load older notifications"}
          </Button>
        </div>
      )}
      {loadMoreError && (
        <p role="alert" className="text-center text-sm text-destructive">
          {loadMoreError}
        </p>
      )}
    </div>
  );
}
