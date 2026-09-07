import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2, LogOut, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCampus } from "@/hooks/useCampus";
import { UserAvatar } from "@/components/StoredMedia";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AVATAR_MAX_BYTES,
  GENDER_OPTIONS,
  INTEREST_OPTIONS,
  PHONE_RE,
  TIER_LIMITS,
  YEAR_OPTIONS,
  daysLeft,
  sanitizeText,
  type Gender,
  type Tier,
} from "@/lib/campus";
import { uploadFile } from "@/lib/storage";
import { disablePush, enablePush } from "@/lib/push";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "Your profile & plan — MKU Pulse" },
      {
        name: "description",
        content: "Update your campus profile, manage notifications and upgrade your plan via M-Pesa.",
      },
      { property: "og:title", content: "Your profile & plan — MKU Pulse" },
      { property: "og:description", content: "Manage your MKU Pulse profile and plan." },
    ],
  }),
  component: ProfilePage,
});


function ProfilePage() {
  const { profile, user, tier, limits, freeAccessMode, refreshProfile, signOut } = useCampus();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [major, setMajor] = useState("");
  const [year, setYear] = useState("1");
  const [gender, setGender] = useState<Gender | "">("");
  const [bio, setBio] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setFullName(profile.full_name);
    setMajor(profile.major);
    setYear(String(profile.year_of_study ?? 1));
    setGender(profile.gender ?? "");
    setBio(profile.bio);
    setInterests(profile.interests ?? []);
  }, [profile?.id]);

  // Contact details live in a private table only the owner (and admin) can read.
  useEffect(() => {
    if (!user) return;
    let active = true;
    void supabase
      .from("profile_contacts")
      .select("phone")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (active && data?.phone) setPhone(data.phone);
      });
    return () => {
      active = false;
    };
  }, [user?.id]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!PHONE_RE.test(phone.trim())) {
      toast.error("Phone must look like +254XXXXXXXXX");
      return;
    }
    if (!gender) {
      toast.error("Please select your gender");
      return;
    }
    setSaving(true);
    const [{ error }, { error: cErr }] = await Promise.all([
      supabase
        .from("profiles")
        .update({
          full_name: sanitizeText(fullName, 80),
          major: sanitizeText(major, 80),
          year_of_study: Number(year),
          gender,
          bio: sanitizeText(bio, 400),
          interests,
        })
        .eq("id", user.id),
      supabase
        .from("profile_contacts")
        .upsert({ id: user.id, email: user.email ?? "", phone: phone.trim() }),
    ]);
    setSaving(false);
    const failure = error ?? cErr;
    if (failure) toast.error(failure.message);
    else {
      toast.success("Profile updated");
      await refreshProfile();
    }
  };


  const changeAvatar = async (file: File | null) => {
    if (!file || !user) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Choose an image file");
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      toast.error("Profile picture must be 5MB or smaller");
      return;
    }

    try {
      const path = await uploadFile("avatars", user.id, file);
      const { error } = await supabase
        .from("profiles")
        .update({ avatar_url: path })
        .eq("id", user.id);
      if (error) throw error;
      toast.success("Photo updated");
      await refreshProfile();
    } catch {
      toast.error("Could not upload that photo");
    }
  };

  const toggleFlag = async (key: "notifications_enabled" | "is_private", value: boolean) => {
    if (!user) return;
    const patch =
      key === "is_private" ? { is_private: value } : { notifications_enabled: value };
    const { error } = await supabase.from("profiles").update(patch).eq("id", user.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (key === "notifications_enabled") {
      if (value) {
        const token = await enablePush();
        if (!token) toast.error("Allow notifications in your browser or app settings to get pushes");
      } else {
        await disablePush();
      }
    }
    await refreshProfile();
  };

  const handleSignOut = async () => {
    await signOut();
    void navigate({ to: "/auth", search: { mode: "signin" }, replace: true });
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-4">
        <div className="relative">
          <UserAvatar
            path={profile?.avatar_url}
            name={profile?.full_name ?? "You"}
            className="size-20"
          />
          <label
            htmlFor="avatar-input"
            className="absolute -bottom-1 -right-1 flex size-9 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground"
            aria-label="Change profile photo"
          >
            <Upload className="size-4" aria-hidden="true" />
          </label>
          <input
            id="avatar-input"
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => void changeAvatar(e.target.files?.[0] ?? null)}
          />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold">{profile?.full_name || "Your profile"}</h1>
          <p className="text-sm text-muted-foreground">{user?.email}</p>
          <Badge variant="outline" className="mt-1 capitalize">
            {limits.label} plan
            {freeAccessMode ? " (free access mode)" : ""}
          </Badge>
        </div>
        <Button variant="ghost" className="ml-auto min-h-11" onClick={() => void handleSignOut()}>
          <LogOut className="mr-2 size-4" aria-hidden="true" />
          Sign out
        </Button>
      </header>

      <form onSubmit={save} className="space-y-4 rounded-2xl border border-border bg-card p-5">
        <h2 className="font-display text-lg font-bold">Details</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="p-name">Full name</Label>
            <Input
              id="p-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1 min-h-11"
            />
          </div>
          <div>
            <Label htmlFor="p-phone">Phone</Label>
            <Input
              id="p-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1 min-h-11"
            />
          </div>
          <div>
            <Label htmlFor="p-major">Major / department</Label>
            <Input
              id="p-major"
              value={major}
              onChange={(e) => setMajor(e.target.value)}
              className="mt-1 min-h-11"
            />
          </div>
          <div>
            <Label htmlFor="p-year">Year of study</Label>
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger id="p-year" className="mt-1 min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {YEAR_OPTIONS.map((y) => (
                  <SelectItem key={y} value={y}>
                    Year {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="p-gender">Gender</Label>
            <Select value={gender} onValueChange={(v) => setGender(v as Gender)}>
              <SelectTrigger id="p-gender" className="mt-1 min-h-11">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {GENDER_OPTIONS.map((g) => (
                  <SelectItem key={g.value} value={g.value}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <Label htmlFor="p-bio">Bio</Label>
          <Textarea
            id="p-bio"
            rows={3}
            maxLength={400}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label>Interests</Label>
          <div className="mt-2 flex flex-wrap gap-2">
            {INTEREST_OPTIONS.map((i) => {
              const on = interests.includes(i);
              return (
                <button
                  key={i}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setInterests((list) =>
                      on ? list.filter((x) => x !== i) : [...list, i].slice(0, 10),
                    )
                  }
                  className={`min-h-11 rounded-full border px-3 text-sm ${
                    on
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  {i}
                </button>
              );
            })}
          </div>
        </div>
        <Button type="submit" disabled={saving} className="min-h-11">
          {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
          Save changes
        </Button>
      </form>

      <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
        <h2 className="font-display text-lg font-bold">Preferences</h2>
        <label className="flex min-h-11 items-center justify-between gap-4 text-sm">
          <span>
            Push notifications
            <span className="block text-xs text-muted-foreground">
              Messages, matches and approvals
            </span>
          </span>
          <Switch
            checked={profile?.notifications_enabled ?? true}
            onCheckedChange={(v) => void toggleFlag("notifications_enabled", v)}
            aria-label="Push notifications"
          />
        </label>
        <label className="flex min-h-11 items-center justify-between gap-4 text-sm">
          <span>
            Private profile
            <span className="block text-xs text-muted-foreground">
              Hide me from the Connect deck
            </span>
          </span>
          <Switch
            checked={profile?.is_private ?? false}
            onCheckedChange={(v) => void toggleFlag("is_private", v)}
            aria-label="Private profile"
          />
        </label>
      </section>

      <Subscription currentTier={tier} />
    </div>
  );
}

interface PaymentRow {
  id: string;
  tier: Tier;
  amount: number;
  mpesa_code: string;
  status: "pending" | "approved" | "rejected";
  admin_note: string | null;
  created_at: string;
}

function Subscription({ currentTier }: { currentTier: Tier }) {
  const { user, profile, freeAccessMode, paymentInfo } = useCampus();
  const PRICES: Record<Exclude<Tier, "free">, number> = {
    mid: paymentInfo.mid_price,
    full: paymentInfo.full_price,
  };
  const [requests, setRequests] = useState<PaymentRow[]>([]);
  const [wanted, setWanted] = useState<Exclude<Tier, "free">>("mid");
  const [code, setCode] = useState("");
  const [payer, setPayer] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("payment_requests")
      .select("id, tier, amount, mpesa_code, status, admin_note, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setRequests((data ?? []) as PaymentRow[]);
  };

  useEffect(() => {
    void load();
  }, [user?.id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const cleanCode = code.trim().toUpperCase();
    if (cleanCode.length < 8) {
      toast.error("Enter the full M-Pesa transaction code");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("payment_requests").insert({
      user_id: user.id,
      tier: wanted,
      amount: PRICES[wanted],
      mpesa_code: cleanCode,
      payer_name: sanitizeText(payer, 80),
      status: "pending",
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setCode("");
    setPayer("");
    toast.success("Payment submitted — the admin team will confirm shortly");
    await load();
  };

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
      <div>
        <h2 className="font-display text-lg font-bold">Your plan</h2>
        <p className="text-sm text-muted-foreground">
          {freeAccessMode
            ? "Free Access Mode is on — everyone has full features right now."
            : currentTier === "free"
              ? "You're on the Free plan."
              : `${TIER_LIMITS[currentTier].label} plan · ${daysLeft(profile?.tier_expires_at ?? null)} days left`}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {(["free", "mid", "full"] as Tier[]).map((t) => {
          const l = TIER_LIMITS[t];
          return (
            <div
              key={t}
              className={`rounded-xl border p-4 ${
                currentTier === t ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              <p className="font-display font-semibold">{l.label}</p>
              <p className="text-sm text-muted-foreground">
                {t === "free" ? "KES 0" : `KES ${PRICES[t as "mid" | "full"]} / month`}
              </p>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                <li>{l.postsPerDay} posts / day</li>
                <li>{l.swipesPerDay} swipes / day</li>
                <li>{l.canPostImage ? "Photo posts" : "Text posts only"}</li>
                <li>{l.canPostVideo ? "Video posts" : "No video"}</li>
                <li>{l.canChatMatches ? "Chat with matches" : "Mentorship chat only"}</li>
              </ul>
            </div>
          );
        })}
      </div>

      <form onSubmit={submit} className="space-y-3 rounded-xl bg-secondary/60 p-4">
        <p className="text-sm">
          Send your payment to <span className="font-semibold">{paymentInfo.number}</span> via M-Pesa,
          then paste the transaction code below for manual approval.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="pay-tier">Plan</Label>
            <select
              id="pay-tier"
              value={wanted}
              onChange={(e) => setWanted(e.target.value as "mid" | "full")}
              className="mt-1 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="mid">Mid — KES {PRICES.mid}</option>
              <option value="full">Full — KES {PRICES.full}</option>
            </select>
          </div>
          <div>
            <Label htmlFor="pay-code">M-Pesa code</Label>
            <Input
              id="pay-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="mt-1 min-h-11"
            />
          </div>
          <div>
            <Label htmlFor="pay-name">Name on payment</Label>
            <Input
              id="pay-name"
              required
              value={payer}
              onChange={(e) => setPayer(e.target.value)}
              className="mt-1 min-h-11"
            />
          </div>
        </div>
        <Button type="submit" disabled={busy} className="min-h-11">
          {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
          Submit payment
        </Button>
      </form>

      {requests.length > 0 && (
        <ul className="space-y-2">
          {requests.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
            >
              <span>
                {TIER_LIMITS[r.tier].label} · KES {r.amount} · {r.mpesa_code}
                {r.admin_note ? ` — ${r.admin_note}` : ""}
              </span>
              <Badge
                className={
                  r.status === "approved"
                    ? "bg-success text-success-foreground"
                    : r.status === "rejected"
                      ? "bg-destructive text-destructive-foreground"
                      : ""
                }
                variant={r.status === "pending" ? "secondary" : "default"}
              >
                {r.status}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
