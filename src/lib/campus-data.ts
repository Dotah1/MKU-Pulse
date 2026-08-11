import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "@/lib/campus";

export type MiniProfile = Pick<
  Profile,
  "id" | "full_name" | "avatar_url" | "major" | "year_of_study" | "bio" | "interests" | "tier"
>;

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
