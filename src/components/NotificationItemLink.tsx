import { Link, useNavigate } from "@tanstack/react-router";
import type { MouseEvent, ReactNode } from "react";
import type { AppNotification } from "@/hooks/useNotifications";
import { notificationHref } from "@/lib/links";

type Props = {
  notification: Pick<AppNotification, "id" | "url" | "kind">;
  markRead: (id: string) => Promise<void>;
  onNavigate?: () => void;
  className?: string;
  children: ReactNode;
};

export function NotificationItemLink({
  notification,
  markRead,
  onNavigate,
  className,
  children,
}: Props) {
  const navigate = useNavigate();
  const destination = notificationHref(notification.url, notification.kind);

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      void markRead(notification.id);
      return;
    }

    event.preventDefault();
    onNavigate?.();
    void (async () => {
      try {
        await markRead(notification.id);
      } catch (error) {
        console.error("Could not mark notification as read", error);
      }
      await navigate({ to: destination });
    })();
  };

  return (
    <Link to={destination} onClick={handleClick} className={className}>
      {children}
    </Link>
  );
}
