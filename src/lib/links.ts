/**
 * Notification rows store their destination as a plain string, while TanStack
 * Router's <Link to> expects a known route path. This alias lets us cast a
 * stored path (always app-internal, validated server-side to start with "/").
 */
export type RouteTo =
  "/feed" | "/connect" | "/mentorship" | "/messages" | "/profile" | "/notifications" | "/admin";
