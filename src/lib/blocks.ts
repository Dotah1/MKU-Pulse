import { supabase } from "@/integrations/supabase/client";

export const REPORT_CATEGORIES = [
  "Harassment or bullying",
  "Spam or scam",
  "Fake profile / impersonation",
  "Inappropriate content",
  "Threats or safety concern",
  "Other",
] as const;

/** IDs of everyone the current user blocked or was blocked by. */
export async function fetchBlockedIds(): Promise<Set<string>> {
  const { data } = await supabase.rpc("blocked_user_ids");
  return new Set(((data ?? []) as unknown as string[]).map(String));
}

export async function isBlockedWith(me: string, other: string): Promise<boolean> {
  const { data } = await supabase.rpc("is_blocked_between", { _a: me, _b: other });
  return Boolean(data);
}

export async function iBlocked(me: string, other: string): Promise<boolean> {
  const { data } = await supabase
    .from("blocked_users")
    .select("id")
    .eq("blocker_id", me)
    .eq("blocked_id", other)
    .maybeSingle();
  return Boolean(data);
}

export async function blockUser(me: string, other: string) {
  const { error } = await supabase
    .from("blocked_users")
    .insert({ blocker_id: me, blocked_id: other });
  if (error && error.code !== "23505") throw error;
}

export async function unblockUser(me: string, other: string) {
  const { error } = await supabase
    .from("blocked_users")
    .delete()
    .eq("blocker_id", me)
    .eq("blocked_id", other);
  if (error) throw error;
}

export async function unmatchUser(me: string, other: string) {
  const a = me < other ? me : other;
  const b = me < other ? other : me;
  const { error } = await supabase
    .from("matches")
    .update({ is_active: false })
    .eq("user_a", a)
    .eq("user_b", b);
  if (error) throw error;
  // Turn my like into a pass so the match doesn't re-form.
  await supabase
    .from("swipes")
    .update({ action: "pass" })
    .eq("swiper_id", me)
    .eq("swipee_id", other);
}

export async function reportUser(me: string, other: string, category: string, details: string) {
  const reason = details.trim() ? `${category}: ${details.trim()}` : category;
  const { error } = await supabase
    .from("reports")
    .insert({ reporter_id: me, target_type: "user", target_id: other, reason });
  if (error) throw error;
}
