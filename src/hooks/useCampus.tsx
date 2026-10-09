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
import { disablePush } from "@/lib/push";
import {
  ADMIN_EMAIL,
  TIER_LIMITS,
  effectiveTier,
  isExpired,
  type Profile,
  type Tier,
  type TierLimits,
} from "@/lib/campus";

export interface PaymentInfo {
  number: string;
  mid_price: number;
  full_price: number;
}

export const DEFAULT_PAYMENT_INFO: PaymentInfo = {
  number: "0713249119",
  mid_price: 150,
  full_price: 300,
};

interface CampusState {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  isAdmin: boolean;
  freeAccessMode: boolean;
  paymentInfo: PaymentInfo;
  tier: Tier;
  limits: TierLimits;
  refreshProfile: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  setFreeAccessModeLocal: (enabled: boolean) => void;
  setPaymentInfoLocal: (info: PaymentInfo) => void;
  signOut: () => Promise<void>;
}

const Ctx = createContext<CampusState | null>(null);

export function CampusProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [freeAccessMode, setFreeAccessMode] = useState(false);
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo>(DEFAULT_PAYMENT_INFO);

  const loadProfile = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from("profiles")
      .select(
        "id, full_name, year_of_study, major, avatar_url, bio, interests, gender, tier, tier_expires_at, pending_tier, is_banned, post_block_until, notifications_enabled, is_private, created_at",
      )
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
      .in("key", ["free_access_mode", "payment_info"]);
    for (const row of data ?? []) {
      if (row.key === "free_access_mode") {
        const v = (row.value ?? null) as { enabled?: boolean } | null;
        setFreeAccessMode(Boolean(v?.enabled));
      }
      if (row.key === "payment_info") {
        const v = (row.value ?? {}) as Partial<PaymentInfo>;
        setPaymentInfo({
          number: v.number || DEFAULT_PAYMENT_INFO.number,
          mid_price: Number(v.mid_price ?? DEFAULT_PAYMENT_INFO.mid_price),
          full_price: Number(v.full_price ?? DEFAULT_PAYMENT_INFO.full_price),
        });
      }
    }
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
    const idleDisconnectMs = 2 * 60 * 1000;
    let idleTimer: number | null = null;
    let disconnectPending: Promise<unknown> | null = null;
    let needsReconnect = false;

    const clearIdleTimer = () => {
      if (idleTimer === null) return;
      window.clearTimeout(idleTimer);
      idleTimer = null;
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        clearIdleTimer();
        idleTimer = window.setTimeout(() => {
          idleTimer = null;
          if (document.visibilityState !== "hidden") return;
          needsReconnect = true;
          disconnectPending = supabase.realtime.disconnect().catch((error: unknown) => {
            console.warn("Could not suspend the idle Realtime connection", error);
          });
        }, idleDisconnectMs);
        return;
      }

      clearIdleTimer();
      if (!needsReconnect) return;
      void (async () => {
        await disconnectPending;
        disconnectPending = null;
        if (document.visibilityState !== "visible") return;
        supabase.realtime.connect();
        needsReconnect = false;
        await loadSettings();
      })().catch((error: unknown) => {
        console.warn("Could not resume the Realtime connection", error);
      });
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    if (document.visibilityState === "hidden") handleVisibilityChange();
    return () => {
      clearIdleTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loadSettings]);

  useEffect(() => {
    const uid = session?.user.id;
    if (!uid) return;
    void loadProfile(uid);
  }, [session?.user.id, loadProfile]);

  // If the sign-up photo could not be uploaded yet (email confirmation), finish
  // the job the first time the student is signed in.
  useEffect(() => {
    const uid = session?.user.id;
    if (!uid || !profile || profile.avatar_url) return;
    let cancelled = false;
    void (async () => {
      const { uploadPendingAvatar } = await import("@/lib/pending-avatar");
      const done = await uploadPendingAvatar(uid);
      if (done && !cancelled) await loadProfile(uid);
    })();
    return () => {
      cancelled = true;
    };
  }, [session, profile, loadProfile]);

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
      paymentInfo,
      tier,
      limits: TIER_LIMITS[tier],
      refreshProfile: async () => {
        if (session?.user.id) await loadProfile(session.user.id);
      },
      refreshSettings: loadSettings,
      setFreeAccessModeLocal: setFreeAccessMode,
      setPaymentInfoLocal: setPaymentInfo,
      signOut: async () => {
        const userId = session?.user.id;
        if (userId && !(await disablePush(userId))) {
          throw new Error("Could not confirm device push-token cleanup; sign-out was paused");
        }
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      },
    }),
    [
      loading,
      session,
      profile,
      isAdmin,
      freeAccessMode,
      paymentInfo,
      tier,
      loadProfile,
      loadSettings,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCampus(): CampusState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCampus must be used inside CampusProvider");
  return ctx;
}
