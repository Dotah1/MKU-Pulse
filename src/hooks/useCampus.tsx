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
  DEFAULT_PAYMENT_INFO,
  TIER_LIMITS,
  effectiveTier,
  isExpired,
  type PaymentInfo,
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
  paymentInfo: PaymentInfo;
  tier: Tier;
  limits: TierLimits;
  refreshProfile: (userId?: string) => Promise<void>;
  refreshSettings: () => Promise<void>;
  setFreeAccessModeLocal: (enabled: boolean) => void;
  setPaymentInfoLocal: (info: PaymentInfo) => void;
  signOut: () => Promise<void>;
}

const Ctx = createContext<CampusState | null>(null);
const SETTINGS_CACHE_TTL_MS = 2 * 60 * 1000;

interface CampusSettingsSnapshot {
  freeAccessMode: boolean;
  paymentInfo: PaymentInfo;
  cachedAt: number;
}

let campusSettingsCache: CampusSettingsSnapshot | null = null;
let campusSettingsRequest: Promise<CampusSettingsSnapshot | null> | null = null;
let campusSettingsRequestId = 0;

async function fetchCampusSettings(force = false): Promise<CampusSettingsSnapshot | null> {
  if (
    !force &&
    campusSettingsCache &&
    Date.now() - campusSettingsCache.cachedAt < SETTINGS_CACHE_TTL_MS
  ) {
    return campusSettingsCache;
  }
  if (!force && campusSettingsRequest) return campusSettingsRequest;

  const requestId = ++campusSettingsRequestId;
  const request = (async () => {
    const { data, error } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", ["free_access_mode", "payment_info"]);
    if (error || !data || requestId !== campusSettingsRequestId) return null;

    const next: CampusSettingsSnapshot = {
      freeAccessMode: campusSettingsCache?.freeAccessMode ?? false,
      paymentInfo: campusSettingsCache?.paymentInfo ?? DEFAULT_PAYMENT_INFO,
      cachedAt: Date.now(),
    };
    for (const row of data) {
      if (row.key === "free_access_mode") {
        const value = (row.value ?? null) as { enabled?: boolean } | null;
        next.freeAccessMode = Boolean(value?.enabled);
      }
      if (row.key === "payment_info") {
        const value = (row.value ?? {}) as Partial<PaymentInfo>;
        next.paymentInfo = {
          number: value.number || DEFAULT_PAYMENT_INFO.number,
          mid_price: Number(value.mid_price ?? DEFAULT_PAYMENT_INFO.mid_price),
          full_price: Number(value.full_price ?? DEFAULT_PAYMENT_INFO.full_price),
        };
      }
    }
    campusSettingsCache = next;
    return next;
  })();
  campusSettingsRequest = request;
  try {
    return await request;
  } finally {
    if (requestId === campusSettingsRequestId) campusSettingsRequest = null;
  }
}

export function CampusProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [freeAccessMode, setFreeAccessMode] = useState(false);
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo>(DEFAULT_PAYMENT_INFO);

  const loadProfile = useCallback(async (userId: string) => {
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
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

  const loadSettings = useCallback(async (force = false) => {
    const settings = await fetchCampusSettings(force);
    if (!settings) return;
    setFreeAccessMode(settings.freeAccessMode);
    setPaymentInfo(settings.paymentInfo);
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
    const onFocus = () => void loadSettings();
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadSettings();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
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
      refreshProfile: async (userId) => {
        const id = userId ?? session?.user.id;
        if (id) await loadProfile(id);
      },
      refreshSettings: () => loadSettings(true),
      setFreeAccessModeLocal: (enabled) => {
        setFreeAccessMode(enabled);
        if (campusSettingsCache) {
          campusSettingsCache = { ...campusSettingsCache, freeAccessMode: enabled };
        }
      },
      setPaymentInfoLocal: (info) => {
        setPaymentInfo(info);
        if (campusSettingsCache) {
          campusSettingsCache = { ...campusSettingsCache, paymentInfo: info };
        }
      },
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
