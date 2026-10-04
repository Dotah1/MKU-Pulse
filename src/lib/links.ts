const INTERNAL_BASE = "https://mku-pulse.invalid";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATIC_ROUTES = new Set([
  "/feed",
  "/connect",
  "/mentorship",
  "/messages",
  "/profile",
  "/notifications",
  "/admin",
]);

/** Internal destinations accepted by notification links. */
export type RouteTo =
  | "/"
  | "/feed"
  | "/connect"
  | "/mentorship"
  | "/messages"
  | "/profile"
  | "/notifications"
  | "/admin"
  | "/p/$id"
  | "/u/$id";

/**
 * Notification URLs are database data. Keep navigation on known app routes and
 * retain only supported message search parameters so stale/invalid links do not
 * break route rendering.
 */
export function notificationHref(rawUrl: string | null, kind?: string): RouteTo {
  if (!rawUrl || rawUrl.length > 2048) return "/notifications";

  try {
    const target = new URL(rawUrl, INTERNAL_BASE);
    if (target.origin !== INTERNAL_BASE) return "/notifications";

    const { pathname } = target;
    const isPostRoute = /^\/p\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      pathname,
    );
    const isProfileRoute =
      /^\/u\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pathname);
    if (!STATIC_ROUTES.has(pathname) && !isPostRoute && !isProfileRoute) {
      return "/notifications";
    }

    if (pathname === "/messages") {
      const safeSearch = new URLSearchParams();
      const allowedKeys = kind === "message" ? ["c", "p", "notification_event"] : ["c", "p"];
      for (const key of allowedKeys) {
        const value = target.searchParams.get(key);
        if (value && UUID_PATTERN.test(value)) safeSearch.set(key, value);
      }
      if (kind === "message" && safeSearch.has("notification_event")) {
        safeSearch.set("notification_kind", "message");
      }
      const query = safeSearch.toString();
      return `${pathname}${query ? `?${query}` : ""}${target.hash}` as RouteTo;
    }

    return `${pathname}${target.search}${target.hash}` as RouteTo;
  } catch {
    return "/notifications";
  }
}
