import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "@/lib/campus";

export type MiniProfile = Pick<
  Profile,
  "id" | "full_name" | "avatar_url" | "major" | "year_of_study" | "bio" | "interests" | "tier"
>;

const PROFILE_CACHE_TTL_MS = 10 * 60 * 1000;
const PROFILE_CACHE_MAX_ENTRIES = 500;
export const POST_AUTHOR_PROFILE_CACHE_MAX_AGE_MS = 2 * 60 * 1000;

interface ProfileCacheEntry {
  profileId: string;
  profile: MiniProfile;
  cachedAt: number;
}

interface PendingProfileRequest {
  profileIds: string[];
  promise: Promise<Record<string, MiniProfile>>;
}

const profileCache = new Map<string, ProfileCacheEntry>();
const pendingProfileRequests = new Map<string, PendingProfileRequest>();
let activeProfileCacheUserId: string | null = null;
let profileAuthStateObserved = false;

function profileCacheKey(userId: string, profileId: string) {
  return JSON.stringify([userId, profileId]);
}

/** Keep in-memory profile data isolated to the currently authenticated browser user. */
export function setProfileCacheUser(userId: string | null) {
  profileAuthStateObserved = true;
  if (activeProfileCacheUserId === userId) return;
  activeProfileCacheUserId = userId;
  profileCache.clear();
  pendingProfileRequests.clear();
}

function cacheProfile(userId: string, profile: MiniProfile) {
  const key = profileCacheKey(userId, profile.id);
  profileCache.delete(key);
  profileCache.set(key, { profileId: profile.id, profile, cachedAt: Date.now() });

  const now = Date.now();
  for (const [entryKey, entry] of profileCache) {
    if (now - entry.cachedAt >= PROFILE_CACHE_TTL_MS) profileCache.delete(entryKey);
  }
  while (profileCache.size > PROFILE_CACHE_MAX_ENTRIES) {
    const oldestKey = profileCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    profileCache.delete(oldestKey);
  }
}

function getCachedProfile(userId: string, profileId: string, maxAgeMs: number): MiniProfile | null {
  if (activeProfileCacheUserId !== userId) return null;
  const key = profileCacheKey(userId, profileId);
  const entry = profileCache.get(key);
  if (!entry) return null;
  const age = Date.now() - entry.cachedAt;
  if (age >= PROFILE_CACHE_TTL_MS) {
    profileCache.delete(key);
    return null;
  }
  if (age >= maxAgeMs) return null;

  // Refresh insertion order so eviction behaves like a small LRU cache.
  profileCache.delete(key);
  profileCache.set(key, entry);
  return entry.profile;
}

/** Read any currently cached profile rows without starting a network request. */
export function getCachedProfiles(
  ids: string[],
  viewerId: string,
  maxAgeMs = PROFILE_CACHE_TTL_MS,
): Record<string, MiniProfile> {
  const maxAge = Math.max(0, Math.min(PROFILE_CACHE_TTL_MS, maxAgeMs));
  const result: Record<string, MiniProfile> = {};
  for (const id of new Set(ids.filter(Boolean))) {
    const profile = getCachedProfile(viewerId, id, maxAge);
    if (profile) result[id] = profile;
  }
  return result;
}

/** Invalidate selected profile entries, or the entire cache when no IDs are supplied. */
export function invalidateProfileCache(ids?: string[]) {
  if (!ids) {
    profileCache.clear();
    pendingProfileRequests.clear();
    return;
  }
  const invalidatedIds = new Set(ids.filter(Boolean));
  if (invalidatedIds.size === 0) return;
  for (const [key, entry] of profileCache) {
    if (invalidatedIds.has(entry.profileId)) profileCache.delete(key);
  }
  for (const [key, request] of pendingProfileRequests) {
    if (request.profileIds.some((id) => invalidatedIds.has(id))) {
      pendingProfileRequests.delete(key);
    }
  }
}

export interface PostCardMetrics {
  post_id: string;
  like_count: number;
  comment_count: number;
  viewer_liked: boolean;
  viewer_reported: boolean;
}

export interface InboxConversationRow {
  id: string;
  user_a: string;
  user_b: string;
  last_message: string;
  last_message_at: string;
  unread_count: number;
  is_mentor: boolean;
}

type ScaleRpcDefinitions = {
  get_connect_candidates: {
    args: { _after_id: string | null; _limit: number };
    row: MiniProfile & { is_banned: boolean; is_private: boolean };
  };
  get_my_conversation_page: {
    args: {
      _before_id: string | null;
      _before_last_message_at: string | null;
      _conversation_id: string | null;
      _limit: number;
    };
    row: InboxConversationRow;
  };
  get_post_card_metrics: {
    args: { _post_ids: string[] };
    row: PostCardMetrics;
  };
  get_my_daily_quota_usage: {
    args: Record<string, never>;
    row: {
      posts_count: number;
      videos_count: number;
      swipes_count: number;
      super_likes_count: number;
    };
  };
};

type ScaleRpcResult<T> = { data: T[] | null; error: { message: string } | null };

async function callScaleRpc<K extends keyof ScaleRpcDefinitions>(
  name: K,
  args: ScaleRpcDefinitions[K]["args"],
): Promise<ScaleRpcResult<ScaleRpcDefinitions[K]["row"]>> {
  const rpc = supabase.rpc.bind(supabase) as unknown as <Name extends keyof ScaleRpcDefinitions>(
    functionName: Name,
    parameters: ScaleRpcDefinitions[Name]["args"],
  ) => PromiseLike<ScaleRpcResult<ScaleRpcDefinitions[Name]["row"]>>;
  return await rpc(name, args);
}

export function fetchConnectCandidates(afterId: string | null, limit: number) {
  return callScaleRpc("get_connect_candidates", { _after_id: afterId, _limit: limit });
}

export function fetchMyConversationPage(
  args: ScaleRpcDefinitions["get_my_conversation_page"]["args"],
) {
  return callScaleRpc("get_my_conversation_page", args);
}

export async function fetchDailyUserQuotaUsage() {
  try {
    return await callScaleRpc("get_my_daily_quota_usage", {});
  } catch (error) {
    return {
      data: null,
      error: { message: error instanceof Error ? error.message : "Could not load daily usage" },
    };
  }
}

const PULSE_STREAK_KEY = "mku_pulse_streak";

interface PulseStreakRecord {
  count: number;
  lastDate: string;
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Update a once-per-local-day Pulse streak without requiring a backend table. */
export function checkAndUpdateStreak(now: Date = new Date()): number {
  if (typeof window === "undefined") return 0;

  const today = localDateKey(now);
  const yesterday = localDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  let previous: PulseStreakRecord | null = null;

  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(PULSE_STREAK_KEY) ?? "null");
    if (stored && typeof stored === "object") {
      const record = stored as Partial<PulseStreakRecord>;
      if (
        typeof record.count === "number" &&
        Number.isSafeInteger(record.count) &&
        record.count > 0 &&
        typeof record.lastDate === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(record.lastDate)
      ) {
        previous = { count: record.count, lastDate: record.lastDate };
      }
    }
  } catch {
    // A malformed or unavailable local value starts a fresh streak.
  }

  const count =
    previous?.lastDate === today
      ? previous.count
      : previous?.lastDate === yesterday
        ? previous.count + 1
        : 1;

  try {
    window.localStorage.setItem(PULSE_STREAK_KEY, JSON.stringify({ count, lastDate: today }));
  } catch {
    // Keep the UI usable when browser storage is disabled or full.
  }

  return count;
}

export function calculateRoommateCompatibility(
  userInterests: string[] | null | undefined,
  candidateInterests: string[] | null | undefined,
  userYear: number | null | undefined,
  candidateYear: number | null | undefined,
): { percentage: number; sharedInterests: string[] } {
  const normalizedUserInterests = (userInterests ?? [])
    .map((interest) => interest.trim())
    .filter(Boolean);
  const candidateInterestSet = new Set(
    (candidateInterests ?? []).map((interest) => interest.trim().toLocaleLowerCase()),
  );
  const seenShared = new Set<string>();
  const sharedInterests = normalizedUserInterests.filter((interest) => {
    const normalized = interest.toLocaleLowerCase();
    if (!candidateInterestSet.has(normalized) || seenShared.has(normalized)) return false;
    seenShared.add(normalized);
    return true;
  });

  if (
    normalizedUserInterests.length > 0 &&
    candidateInterestSet.size > 0 &&
    sharedInterests.length
  ) {
    return {
      percentage: Math.min(
        95,
        Math.max(
          50,
          Math.round((sharedInterests.length / Math.max(normalizedUserInterests.length, 1)) * 100),
        ),
      ),
      sharedInterests,
    };
  }

  // MKU Pulse is single-campus and profiles have no campus field; year is the available fallback.
  const sameYear = userYear != null && candidateYear != null && userYear === candidateYear;
  return { percentage: sameYear ? 78 : 68, sharedInterests };
}

export async function fetchProfiles(
  ids: string[],
  options: { maxAgeMs?: number; viewerId?: string } = {},
): Promise<Record<string, MiniProfile>> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return {};

  const viewerId = options.viewerId ?? null;
  if (viewerId && !profileAuthStateObserved && activeProfileCacheUserId === null) {
    activeProfileCacheUserId = viewerId;
  }
  const canUseCache = Boolean(viewerId && activeProfileCacheUserId === viewerId);

  const maxAge = Math.max(
    0,
    Math.min(PROFILE_CACHE_TTL_MS, options.maxAgeMs ?? PROFILE_CACHE_TTL_MS),
  );
  const cached = canUseCache && viewerId ? getCachedProfiles(unique, viewerId, maxAge) : {};
  const missing = unique.filter((id) => !cached[id]).sort();
  if (missing.length === 0) return cached;

  if (!canUseCache || !viewerId) {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url, major, year_of_study, bio, interests, tier")
        .in("id", missing);
      if (error) return cached;
      for (const row of (data ?? []) as MiniProfile[]) cached[row.id] = row;
    } catch {
      return cached;
    }
    return cached;
  }

  const requestKey = JSON.stringify([viewerId, missing]);
  let request = pendingProfileRequests.get(requestKey);
  if (!request) {
    const entry: PendingProfileRequest = { profileIds: missing, promise: Promise.resolve({}) };
    entry.promise = (async () => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("id, full_name, avatar_url, major, year_of_study, bio, interests, tier")
          .in("id", missing);
        if (error) return {};

        const result: Record<string, MiniProfile> = {};
        for (const row of (data ?? []) as MiniProfile[]) {
          result[row.id] = row;
          if (
            activeProfileCacheUserId === viewerId &&
            pendingProfileRequests.get(requestKey) === entry
          ) {
            cacheProfile(viewerId, row);
          }
        }
        return result;
      } catch {
        return {};
      }
    })();
    pendingProfileRequests.set(requestKey, entry);
    request = entry;
  }

  try {
    return { ...cached, ...(await request.promise) };
  } finally {
    if (pendingProfileRequests.get(requestKey) === request) {
      pendingProfileRequests.delete(requestKey);
    }
  }
}

/** Fetch interaction counts and viewer flags for a page of posts in one request. */
export async function fetchPostCardMetrics(
  postIds: string[],
): Promise<Record<string, PostCardMetrics> | null> {
  const uniqueIds = [...new Set(postIds)].filter(Boolean).slice(0, 100);
  if (uniqueIds.length === 0) return {};
  try {
    const { data, error } = await callScaleRpc("get_post_card_metrics", {
      _post_ids: uniqueIds,
    });
    if (error) return null;
    return Object.fromEntries((data ?? []).map((row) => [row.post_id, row]));
  } catch {
    return null;
  }
}

/** Find (or create) the 1:1 conversation between two users. */
export async function getOrCreateConversation(me: string, other: string): Promise<string> {
  const [a, b] = me < other ? [me, other] : [other, me];
  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("user_a", a)
    .eq("user_b", b)
    .maybeSingle();
  if (existing?.id) return existing.id;

  const { data, error } = await supabase
    .from("conversations")
    .insert({ user_a: a, user_b: b })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("Could not start the conversation");
  return data.id;
}

export function startOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function countToday(table: "posts" | "swipes", column: string, userId: string) {
  const { count } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(column, userId)
    .gte("created_at", startOfToday());
  return count ?? 0;
}

/** Records today's visit on the server (tamper-proof streak) and returns the verified count. */
export async function checkInServerStreak(now: Date = new Date()): Promise<number | null> {
  const { data, error } = await supabase.rpc("check_in_streak", { _today: localDateKey(now) });
  if (error || typeof data !== "number") return null;
  return data;
}

export const COMPLIMENT_OPTIONS = [
  "Best Dressed in ST Tower",
  "Future First-Class",
  "Library Grinder",
  "Great Energy",
  "Smartest in CATs",
] as const;
