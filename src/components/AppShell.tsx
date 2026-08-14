import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Heart, GraduationCap, MessageCircle, User, Shield } from "lucide-react";
import type { ReactNode } from "react";
import { useCampus } from "@/hooks/useCampus";
import { UserAvatar } from "@/components/StoredMedia";
import { NotificationBell } from "@/components/NotificationBell";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/feed", label: "Feed", icon: Home },
  { to: "/connect", label: "Connect", icon: Heart },
  { to: "/mentorship", label: "Mentors", icon: GraduationCap },
  { to: "/messages", label: "Messages", icon: MessageCircle },
  { to: "/profile", label: "Profile", icon: User },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, isAdmin, tier, freeAccessMode } = useCampus();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <header className="sticky top-0 z-40 border-b border-border bg-card/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4">
          <Link to="/feed" className="font-display text-lg font-bold tracking-tight">
            Campus<span className="text-primary">Connect</span>
          </Link>

          <nav aria-label="Main" className="ml-6 hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-medium transition-colors",
                  pathname === item.to
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                <item.icon className="size-4" aria-hidden="true" />
                {item.label}
              </Link>
            ))}
            {isAdmin && (
              <Link
                to="/admin"
                className={cn(
                  "flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-medium",
                  pathname === "/admin"
                    ? "bg-accent/15 text-accent"
                    : "text-muted-foreground hover:bg-secondary",
                )}
              >
                <Shield className="size-4" aria-hidden="true" />
                Admin
              </Link>
            )}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {freeAccessMode && (
              <Badge className="bg-success text-success-foreground">Free access on</Badge>
            )}
            <Badge variant="outline" className="capitalize">
              {tier}
            </Badge>
            <NotificationBell />
            <Link to="/profile" aria-label="Your profile">
              <UserAvatar
                path={profile?.avatar_url}
                name={profile?.full_name ?? "Student"}
                className="size-9"
              />
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-6">{children}</main>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card md:hidden"
      >
        <div className="flex items-stretch justify-around">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              aria-label={item.label}
              className={cn(
                "flex min-h-14 min-w-11 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium",
                pathname === item.to ? "text-primary" : "text-muted-foreground",
              )}
            >
              <item.icon className="size-5" aria-hidden="true" />
              {item.label}
            </Link>
          ))}
          {isAdmin && (
            <Link
              to="/admin"
              aria-label="Admin"
              className={cn(
                "flex min-h-14 min-w-11 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium",
                pathname === "/admin" ? "text-accent" : "text-muted-foreground",
              )}
            >
              <Shield className="size-5" aria-hidden="true" />
              Admin
            </Link>
          )}
        </div>
      </nav>
    </div>
  );
}
