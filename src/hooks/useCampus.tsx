import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  ADMIN_EMAIL,
  TIER_LIMITS,
  effectiveTier,
  isExpired,
  type Profile,
  type Tier,
  type TierLimits,
} from "@/lib/campus";

interface CampusState {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  isAdmin: boolean;
  freeAccessMode: boolean;
  tier: Tier;
  limits: TierLimits;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<CampusState | null>(null);

export function CampusProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [freeAccessMode, setFreeAccessMode] = useState(false);

  const loadProfile = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    const p = (data as Profile | null) ?? null;
    setProfile(p);
    // Auto-downgrade once a paid tier has lapsed.
    if (p && p.tier !== "free" && isExpired(p.tier_expires_at)) {
      await supabase
        .from("profiles")
        .update({ tier: "free", tier_expires_at: null })
        .eq("id", userId);
      setProfile({ ...p, tier: "free", tier_expires_at: null });
    }
  }, []);

  const loadSettings = useCallback(async () => {
    const { data } = await supabase
      .from("app_settings")
      .select("key, value")
      .eq("key", "free_access_mode")
      .maybeSingle();
    const value = (data?.value ?? null) as { enabled?: boolean } | null;
    setFreeAccessMode(Boolean(value?.enabled));
  }, []);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) setProfile(null);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    void loadSettings();
    const channel = supabase
      .channel("settings-watch")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_settings" },
        () => void loadSettings(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadSettings]);

  useEffect(() => {
    const uid = session?.user.id;
    if (!uid) return;
    void loadProfile(uid);
  }, [session?.user.id, loadProfile]);

  // Register the service worker and prompt for notifications a minute after login.
  useEffect(() => {
    if (typeof window === "undefined" || !session) return;
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    const t = window.setTimeout(() => {
      if ("Notification" in window && Notification.permission === "default") {
        void Notification.requestPermission();
      }
    }, 60_000);
    return () => window.clearTimeout(t);
  }, [session]);

  // Live notifications for new messages and matches.
  useEffect(() => {
    const uid = session?.user.id;
    if (!uid) return;

    const notify = (title: string, body: string) => {
      if (typeof window === "undefined") return;
      if (!("Notification" in window) || Notification.permission !== "granted") return;
      void navigator.serviceWorker?.ready
        .then((reg) => reg.showNotification(title, { body, icon: "/favicon.ico" }))
        .catch(() => {
          new Notification(title, { body });
        });
    };

    const channel = supabase
      .channel(`alerts-${uid}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const row = payload.new as { sender_id: string; content: string };
          if (row.sender_id !== uid) notify("New message", row.content.slice(0, 120));
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "matches" },
        () => notify("It's a match!", "You have a new match on Campus Connect."),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [session?.user.id]);

  const email = session?.user.email?.toLowerCase() ?? "";
  const isAdmin = email === ADMIN_EMAIL;
  const tier = effectiveTier(profile, freeAccessMode);

  const value = useMemo<CampusState>(
    () => ({
      loading,
      session,
      user: session?.user ?? null,
      profile,
      isAdmin,
      freeAccessMode,
      tier,
      limits: TIER_LIMITS[tier],
      refreshProfile: async () => {
        if (session?.user.id) await loadProfile(session.user.id);
      },
      signOut: async () => {
        await supabase.auth.signOut();
      },
    }),
    [loading, session, profile, isAdmin, freeAccessMode, tier, loadProfile],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCampus(): CampusState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCampus must be used inside CampusProvider");
  return ctx;
}
