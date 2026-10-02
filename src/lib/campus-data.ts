import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "@/lib/campus";

export type MiniProfile = Pick<
  Profile,
  "id" | "full_name" | "avatar_url" | "major" | "year_of_study" | "bio" | "interests" | "tier"
>;

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

export async function fetchProfiles(ids: string[]): Promise<Record<string, MiniProfile>> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return {};
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url, major, year_of_study, bio, interests, tier")
    .in("id", unique);
  const map: Record<string, MiniProfile> = {};
  for (const row of (data ?? []) as MiniProfile[]) map[row.id] = row;
  return map;
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
