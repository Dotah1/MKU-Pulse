import { createFileRoute, Link } from "@tanstack/react-router";
import { BellOff, Loader2 } from "lucide-react";
import { useNotifications } from "@/hooks/useNotifications";
import { Button } from "@/components/ui/button";
import { timeAgo } from "@/lib/campus";
import type { RouteTo } from "@/lib/links";

export const Route = createFileRoute("/_authenticated/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — Campus Connect" },
      {
        name: "description",
        content: "Every message, match, mentorship and payment update from Campus Connect in one place.",
      },
      { property: "og:title", content: "Notifications — Campus Connect" },
      { property: "og:description", content: "Your Campus Connect notification centre." },
    ],
  }),
  component: NotificationsPage,
});

function NotificationsPage() {
  const { items, loading, unreadCount, markRead, markAllRead } = useNotifications(100);

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            {unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up"}
          </p>
        </div>
        {unreadCount > 0 && (
          <Button variant="outline" className="ml-auto min-h-11" onClick={() => void markAllRead()}>
            Mark all as read
          </Button>
        )}
      </header>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
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
          {items.map((n) => (
            <li key={n.id} className={n.read_at ? "" : "bg-primary/5"}>
              <Link
                to={(n.url ?? "/notifications") as RouteTo}
                onClick={() => void markRead(n.id)}
                className="block px-4 py-4 hover:bg-secondary"
              >
                <div className="flex items-center gap-2">
                  <p className="font-medium">{n.title}</p>
                  {!n.read_at && <span className="size-2 rounded-full bg-primary" aria-hidden="true" />}
                  <span className="ml-auto text-xs text-muted-foreground">{timeAgo(n.created_at)}</span>
                </div>
                {n.body && <p className="mt-1 text-sm text-muted-foreground">{n.body}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
