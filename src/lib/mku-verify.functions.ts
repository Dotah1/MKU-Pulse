import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const MKU_INBOX = "verify.mkupulse@gmail.com";
const MKU_DOMAIN_RE = /^[a-zA-Z0-9._%+-]+@mylife\.mku\.ac\.ke$/;
const CODE_RE = /^MKU-[A-HJ-NP-Z2-9]{6}$/;

function makeCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return "MKU-" + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

async function requireAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Admins only");
}

/** Student: get (or reuse) their personal code for the email they will send from. */
export const requestMkuCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ email: z.string().trim().toLowerCase().max(120) }).parse(d))
  .handler(async ({ data, context }) => {
    if (!MKU_DOMAIN_RE.test(data.email)) throw new Error("Use your @mylife.mku.ac.ke email");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const expires = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const { data: existing } = await supabaseAdmin
      .from("mku_verification_codes")
      .select("code, email, expires_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (existing?.code && existing.email === data.email && new Date(existing.expires_at) > new Date()) {
      return { code: existing.code, email: data.email, expiresAt: existing.expires_at };
    }
    for (let i = 0; i < 5; i++) {
      const code = makeCode();
      const { error } = await supabaseAdmin.from("mku_verification_codes").upsert(
        { user_id: context.userId, email: data.email, code, code_hash: code, attempts: 0, expires_at: expires },
        { onConflict: "user_id" },
      );
      if (!error) return { code, email: data.email, expiresAt: expires };
      if (!error.message.includes("duplicate")) throw new Error(error.message);
    }
    throw new Error("Could not create a code, try again");
  });

/** Admin: see which single account a code belongs to. */
export const lookupMkuCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ code: z.string().trim().toUpperCase() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    if (!CODE_RE.test(data.code)) throw new Error("Codes look like MKU-AB12CD");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("mku_verification_codes")
      .select("user_id, email, expires_at")
      .eq("code", data.code)
      .maybeSingle();
    if (!row) throw new Error("No account has this code");
    const { data: p } = await supabaseAdmin
      .from("profiles")
      .select("full_name, major, year_of_study, mku_verified")
      .eq("id", row.user_id)
      .maybeSingle();
    return {
      userId: row.user_id,
      email: row.email,
      expired: new Date(row.expires_at) < new Date(),
      fullName: p?.full_name ?? "",
      major: p?.major ?? "",
      year: p?.year_of_study ?? null,
      alreadyVerified: Boolean(p?.mku_verified),
    };
  });

/** Admin: approve a code — verifies only the account that owns it. */
export const approveMkuCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ code: z.string().trim().toUpperCase() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    if (!CODE_RE.test(data.code)) throw new Error("Invalid code");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("mku_verification_codes")
      .select("user_id, email, expires_at")
      .eq("code", data.code)
      .maybeSingle();
    if (!row) throw new Error("No account has this code");
    if (new Date(row.expires_at) < new Date()) throw new Error("This code has expired");
    const { error } = await supabaseAdmin.rpc("mark_mku_verified", {
      _user: row.user_id,
      _email: row.email,
    });
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("notifications").insert({
      user_id: row.user_id,
      kind: "system",
      title: "You're a Verified MKU Student ✓",
      body: "Your MKU email has been confirmed. The badge now shows on your profile.",
      url: "/profile",
    });
    return { ok: true, userId: row.user_id };
  });
