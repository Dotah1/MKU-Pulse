import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { useNotifications } from "@/hooks/useNotifications";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { NotificationItemLink } from "@/components/NotificationItemLink";
import { timeAgo } from "@/lib/campus";

export function NotificationBell() {
  const { items, unreadCount, markRead, markAllRead } = useNotifications(15);
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : "Notifications"}
          className="relative flex size-10 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <Bell className="size-5" aria-hidden="true" />
          {unreadCount > 0 && (
            <span className="absolute right-1 top-1 min-w-4 rounded-full bg-primary px-1 text-[10px] font-bold leading-4 text-primary-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <p className="font-display text-sm font-semibold">Notifications</p>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" onClick={() => void markAllRead()}>
              Mark all read
            </Button>
          )}
        </div>
        <ul className="max-h-80 divide-y divide-border overflow-y-auto">
          {items.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              Nothing yet — you're all caught up.
            </li>
          )}
          {items.map((notification) => (
            <li key={notification.id} className={notification.read_at ? "" : "bg-primary/5"}>
              <NotificationItemLink
                notification={notification}
                markRead={markRead}
                onNavigate={() => setOpen(false)}
                className="block px-3 py-3 hover:bg-secondary"
              >
                <p className="min-w-0 break-words [overflow-wrap:anywhere] text-sm font-medium">
                  {notification.title}
                </p>
                {notification.body && (
                  <p className="break-words [overflow-wrap:anywhere] text-xs text-muted-foreground">
                    {notification.body}
                  </p>
                )}
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {timeAgo(notification.created_at)}
                </p>
              </NotificationItemLink>
            </li>
          ))}
        </ul>
        <div className="border-t border-border p-2">
          <Button asChild variant="ghost" size="sm" className="w-full">
            <Link to="/notifications" onClick={() => setOpen(false)}>
              See all notifications
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
