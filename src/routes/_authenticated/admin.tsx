import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2, ShieldAlert, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { notify } from "@/lib/notify";
import { deleteUserAccount } from "@/lib/admin.functions";
import { useCampus } from "@/hooks/useCampus";
import { UserAvatar } from "@/components/StoredMedia";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TIER_LIMITS, sanitizeText, timeAgo, type Tier } from "@/lib/campus";
import { fetchProfiles, type MiniProfile } from "@/lib/campus-data";


export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Admin panel — MKU Pulse" },
      {
        name: "description",
        content: "Approve M-Pesa payments and mentors, moderate reports and post announcements.",
      },
      { property: "og:title", content: "Admin panel — MKU Pulse" },
      { property: "og:description", content: "MKU Pulse administration tools." },
    ],
  }),
  component: AdminPage,
});

interface PaymentRow {
  id: string;
  user_id: string;
  tier: Tier;
  amount: number;
  mpesa_code: string;
  payer_name: string;
  status: string;
  created_at: string;
}

interface MentorAppRow {
  id: string;
  user_id: string;
  expertise: string;
  availability: string;
  experience: string;
  status: string;
  created_at: string;
}

interface ReportRow {
  id: string;
  reporter_id: string;
  target_type: string;
  target_id: string;
  reason: string;
  status: string;
  created_at: string;
}

function AdminPage() {
  const {
    isAdmin,
    user,
    freeAccessMode,
    paymentInfo,
    setFreeAccessModeLocal,
    setPaymentInfoLocal,
    refreshSettings,
  } = useCampus();
  const [priceForm, setPriceForm] = useState({
    number: paymentInfo.number,
    mid_price: String(paymentInfo.mid_price),
    full_price: String(paymentInfo.full_price),
  });
  const [savingPrices, setSavingPrices] = useState(false);

  useEffect(() => {
    setPriceForm({
      number: paymentInfo.number,
      mid_price: String(paymentInfo.mid_price),
      full_price: String(paymentInfo.full_price),
    });
  }, [paymentInfo]);
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [apps, setApps] = useState<MentorAppRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [people, setPeople] = useState<Record<string, MiniProfile>>({});
  const [stats, setStats] = useState({ students: 0, posts: 0, matches: 0 });
  const [announcement, setAnnouncement] = useState("");
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollChoices, setPollChoices] = useState(["", "", "", ""]);
  const [pollBusy, setPollBusy] = useState(false);
  const [userQuery, setUserQuery] = useState("");
  const [found, setFound] = useState<
    (MiniProfile & { is_banned: boolean; post_block_until: string | null })[]
  >([]);
  const [searching, setSearching] = useState(false);


  const load = useCallback(async () => {
    const [p, a, r, students, posts, matches] = await Promise.all([
      supabase
        .from("payment_requests")
        .select("id, user_id, tier, amount, mpesa_code, payer_name, status, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: true }),
      supabase
        .from("mentor_applications")
        .select("id, user_id, expertise, availability, experience, status, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: true }),
      supabase
        .from("reports")
        .select("id, reporter_id, target_type, target_id, reason, status, created_at")
        .order("created_at", { ascending: false })
        .limit(200),

      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("posts").select("id", { count: "exact", head: true }),
      supabase.from("matches").select("id", { count: "exact", head: true }),
    ]);

    const pay = (p.data ?? []) as PaymentRow[];
    const mapp = (a.data ?? []) as MentorAppRow[];
    const rep = (r.data ?? []) as ReportRow[];
    setPayments(pay);
    setApps(mapp);
    setReports(rep);
    setStats({
      students: students.count ?? 0,
      posts: posts.count ?? 0,
      matches: matches.count ?? 0,
    });
    setPeople(
      await fetchProfiles([
        ...pay.map((x) => x.user_id),
        ...mapp.map((x) => x.user_id),
        ...rep.map((x) => x.reporter_id),
      ]),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  if (!isAdmin) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center">
        <ShieldAlert className="mx-auto size-8 text-destructive" aria-hidden="true" />
        <h1 className="mt-3 font-display text-xl font-bold">Admins only</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This area is restricted to the MKU Pulse admin account.
        </p>
      </div>
    );
  }

  const setFreeAccess = async (enabled: boolean) => {
    setFreeAccessModeLocal(enabled);
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: "free_access_mode", value: { enabled }, updated_at: new Date().toISOString() });
    if (error) {
      setFreeAccessModeLocal(!enabled);
      toast.error(error.message);
      return;
    }
    toast.success(enabled ? "Free Access Mode on" : "Free Access Mode off");
    await refreshSettings();
  };

  const savePrices = async () => {
    const mid = Number(priceForm.mid_price);
    const full = Number(priceForm.full_price);
    const number = priceForm.number.replace(/[^\d+]/g, "");
    if (!Number.isFinite(mid) || mid < 0 || !Number.isFinite(full) || full < 0) {
      toast.error("Enter valid prices");
      return;
    }
    if (number.length < 9) {
      toast.error("Enter a valid M-Pesa number");
      return;
    }
    setSavingPrices(true);
    const value = { number, mid_price: Math.round(mid), full_price: Math.round(full) };
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: "payment_info", value, updated_at: new Date().toISOString() });
    setSavingPrices(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setPaymentInfoLocal(value);
    toast.success("Payment details updated for all students");
  };

  const decidePayment = async (row: PaymentRow, approve: boolean, note?: string) => {
    if (!user) return;
    const { error } = await supabase
      .from("payment_requests")
      .update({
        status: approve ? "approved" : "rejected",
        admin_note: note ?? null,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (approve) {
      const expires = new Date(Date.now() + 30 * 86_400_000).toISOString();
      const { error: pErr } = await supabase
        .from("profiles")
        .update({ tier: row.tier, tier_expires_at: expires, pending_tier: null })
        .eq("id", row.user_id);
      if (pErr) toast.error(pErr.message);
    }
    toast.success(approve ? "Payment approved" : "Payment rejected");
    void notify({
      recipientIds: row.user_id,
      title: approve ? "Payment approved" : "Payment not approved",
      body: approve
        ? `Your ${row.tier} plan is active for 30 days.`
        : note || "The M-Pesa code could not be verified.",
      url: "/profile",
      kind: "payment",
    });
    await load();
  };

  const decideMentor = async (row: MentorAppRow, approve: boolean) => {
    if (!user) return;
    const { error } = await supabase
      .from("mentor_applications")
      .update({
        status: approve ? "approved" : "rejected",
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (approve) {
      await supabase.from("mentors").upsert({
        user_id: row.user_id,
        expertise: row.expertise,
        availability: row.availability,
        experience: row.experience,
      });
      await supabase.from("user_roles").insert({ user_id: row.user_id, role: "mentor" });
    }
    toast.success(approve ? "Mentor approved" : "Application rejected");
    void notify({
      recipientIds: row.user_id,
      title: approve ? "You're now a campus mentor" : "Mentor application declined",
      body: approve
        ? "Students can now find you in the mentorship directory."
        : "Feel free to apply again with more detail.",
      url: "/mentorship",
      kind: "mentorship",
    });
    await load();
  };

  const resolveReport = async (row: ReportRow, ban: boolean) => {
    await supabase
      .from("reports")
      .update({ status: ban ? "approved" : "rejected" })
      .eq("id", row.id);
    if (ban && row.target_type === "user") {
      await supabase.from("profiles").update({ is_banned: true }).eq("id", row.target_id);
    }
    if (ban && row.target_type === "post") {
      await supabase.from("posts").delete().eq("id", row.target_id);
    }
    toast.success("Report resolved");
    await load();
  };

  const postAnnouncement = async () => {
    if (!user) return;
    const text = sanitizeText(announcement, 1000);
    if (!text) return;
    const { error } = await supabase
      .from("posts")
      .insert({ user_id: user.id, content: text, is_announcement: true });
    if (error) toast.error(error.message);
    else {
      setAnnouncement("");
      toast.success("Announcement published");
    }
  };

  const createPoll = async () => {
    if (!user) return;
    const question = sanitizeText(pollQuestion, 200);
    const choices = pollChoices.map((c) => sanitizeText(c, 80)).filter(Boolean);
    if (!question) {
      toast.error("Type the poll question");
      return;
    }
    if (choices.length < 2) {
      toast.error("Add at least two choices");
      return;
    }
    setPollBusy(true);
    const { data, error } = await supabase
      .from("polls")
      .insert({ question, created_by: user.id })
      .select("id")
      .single();
    if (error || !data) {
      setPollBusy(false);
      toast.error(error?.message ?? "Could not create the poll");
      return;
    }
    const { error: optError } = await supabase
      .from("poll_options")
      .insert(choices.map((label, i) => ({ poll_id: data.id, label, position: i })));
    setPollBusy(false);
    if (optError) {
      toast.error(optError.message);
      return;
    }
    setPollQuestion("");
    setPollChoices(["", "", "", ""]);
    toast.success("Poll published to the feed");
  };

  const searchUsers = async () => {
    const q = userQuery.trim();
    if (!q) return;
    setSearching(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url, major, year_of_study, is_banned, post_block_until")
      .ilike("full_name", `%${q}%`)
      .limit(20);
    setSearching(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setFound((data ?? []) as typeof found);
  };

  const patchUser = async (
    id: string,
    patch: { is_banned?: boolean; post_block_until?: string | null },
  ) => {
    const { error } = await supabase.from("profiles").update(patch).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setFound((list) => list.map((u) => (u.id === id ? { ...u, ...patch } : u)));
    toast.success("Member updated");
  };

  const blockPosting = async (id: string, hours: number) => {
    const until = hours > 0 ? new Date(Date.now() + hours * 3_600_000).toISOString() : null;
    await patchUser(id, { post_block_until: until });
    if (hours > 0) {
      void notify({
        recipientIds: id,
        title: "Posting paused",
        body: `An admin paused your posting for ${hours >= 24 ? `${hours / 24} day(s)` : `${hours} hour(s)`}.`,
        url: "/feed",
        kind: "moderation",
      });
    }
  };

  const removeAccount = async (id: string, name: string) => {
    if (!window.confirm(`Delete ${name}'s account permanently? This cannot be undone.`)) return;
    try {
      await deleteUserAccount({ data: { userId: id } });
      setFound((list) => list.filter((u) => u.id !== id));
      toast.success("Account deleted");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete that account");
    }
  };


  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold">Admin panel</h1>
        <p className="text-sm text-muted-foreground">MKU Pulse operations</p>
      </header>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Students", value: stats.students },
          { label: "Posts", value: stats.posts },
          { label: "Matches", value: stats.matches },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-border bg-card p-4 text-center">
            <p className="font-display text-2xl font-bold">{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      <section className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-card p-5">
        <div>
          <h2 className="font-display text-base font-semibold">Free Access Mode</h2>
          <p className="text-sm text-muted-foreground">
            Unlock every paid feature for all students.
          </p>
        </div>
        <Switch
          checked={freeAccessMode}
          onCheckedChange={(v) => void setFreeAccess(v)}
          aria-label="Free Access Mode"
        />
      </section>

      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="font-display text-base font-semibold">Subscription pricing</h2>
        <p className="text-sm text-muted-foreground">
          These prices and the M-Pesa number are what every student sees.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="mid-price">Mid plan (KES)</Label>
            <Input
              id="mid-price"
              inputMode="numeric"
              value={priceForm.mid_price}
              onChange={(e) => setPriceForm((f) => ({ ...f, mid_price: e.target.value }))}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="full-price">Full plan (KES)</Label>
            <Input
              id="full-price"
              inputMode="numeric"
              value={priceForm.full_price}
              onChange={(e) => setPriceForm((f) => ({ ...f, full_price: e.target.value }))}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="pay-number">M-Pesa number</Label>
            <Input
              id="pay-number"
              inputMode="tel"
              value={priceForm.number}
              onChange={(e) => setPriceForm((f) => ({ ...f, number: e.target.value }))}
              className="mt-1"
            />
          </div>
        </div>
        <Button className="mt-3 min-h-11" disabled={savingPrices} onClick={() => void savePrices()}>
          {savingPrices ? "Saving…" : "Save pricing"}
        </Button>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="font-display text-base font-semibold">Post an announcement</h2>
        <Textarea
          value={announcement}
          onChange={(e) => setAnnouncement(e.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="Campus-wide announcement…"
          aria-label="Announcement"
          className="mt-3"
        />
        <Button className="mt-3 min-h-11" onClick={() => void postAnnouncement()}>
          Publish to feed
        </Button>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="font-display text-base font-semibold">Create a poll</h2>
        <p className="text-sm text-muted-foreground">
          Students vote in the feed and see live results.
        </p>
        <Input
          value={pollQuestion}
          onChange={(e) => setPollQuestion(e.target.value)}
          maxLength={200}
          placeholder="What should we vote on?"
          aria-label="Poll question"
          className="mt-3 min-h-11"
        />
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {pollChoices.map((choice, i) => (
            <Input
              key={i}
              value={choice}
              onChange={(e) =>
                setPollChoices((list) => list.map((c, idx) => (idx === i ? e.target.value : c)))
              }
              maxLength={80}
              placeholder={`Choice ${i + 1}${i > 1 ? " (optional)" : ""}`}
              aria-label={`Poll choice ${i + 1}`}
              className="min-h-11"
            />
          ))}
        </div>
        <Button className="mt-3 min-h-11" disabled={pollBusy} onClick={() => void createPoll()}>
          {pollBusy ? "Publishing…" : "Publish poll"}
        </Button>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="font-display text-base font-semibold">Manage a member</h2>
        <p className="text-sm text-muted-foreground">
          Pause someone's posting for a while, ban them, or delete their account for good.
        </p>
        <div className="mt-3 flex gap-2">
          <Input
            value={userQuery}
            onChange={(e) => setUserQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void searchUsers();
              }
            }}
            placeholder="Search by name"
            aria-label="Search members"
            className="min-h-11"
          />
          <Button
            variant="outline"
            className="min-h-11"
            disabled={searching}
            onClick={() => void searchUsers()}
          >
            Search
          </Button>
        </div>
        <ul className="mt-3 space-y-3">
          {found.map((u) => {
            const blocked =
              u.post_block_until && new Date(u.post_block_until).getTime() > Date.now();
            return (
              <li key={u.id} className="rounded-xl border border-border p-3">
                <div className="flex items-center gap-3">
                  <UserAvatar path={u.avatar_url} name={u.full_name} className="size-10" />
                  <div className="min-w-0">
                    <Link to="/u/$id" params={{ id: u.id }} className="text-sm font-semibold hover:underline">
                      {u.full_name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {u.is_banned ? "Banned" : blocked ? `Posting paused until ${new Date(u.post_block_until!).toLocaleString()}` : "Active"}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="outline" className="min-h-11" onClick={() => void blockPosting(u.id, 1)}>
                    Pause 1h
                  </Button>
                  <Button variant="outline" className="min-h-11" onClick={() => void blockPosting(u.id, 24)}>
                    Pause 24h
                  </Button>
                  <Button variant="outline" className="min-h-11" onClick={() => void blockPosting(u.id, 168)}>
                    Pause 7 days
                  </Button>
                  {blocked && (
                    <Button variant="ghost" className="min-h-11" onClick={() => void blockPosting(u.id, 0)}>
                      Allow posting
                    </Button>
                  )}
                  <Button
                    variant={u.is_banned ? "ghost" : "destructive"}
                    className="min-h-11"
                    onClick={() => void patchUser(u.id, { is_banned: !u.is_banned })}
                  >
                    {u.is_banned ? "Lift ban" : "Ban from app"}
                  </Button>
                  <Button
                    variant="destructive"
                    className="min-h-11"
                    onClick={() => void removeAccount(u.id, u.full_name)}
                  >
                    <Trash2 className="mr-1 size-4" aria-hidden="true" />
                    Delete account
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>


      {loading ? (
        <Loader2 className="mx-auto my-12 size-6 animate-spin text-muted-foreground" />
      ) : (
        <Tabs defaultValue="payments">
          <TabsList>
            <TabsTrigger value="payments">Payments ({payments.length})</TabsTrigger>
            <TabsTrigger value="mentors">Mentors ({apps.length})</TabsTrigger>
            <TabsTrigger value="reports">
              Reports ({reports.filter((r) => r.status === "pending").length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="payments" className="space-y-3">
            {payments.length === 0 && (
              <p className="text-sm text-muted-foreground">No pending payments.</p>
            )}
            {payments.map((row) => (
              <div key={row.id} className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-center gap-3">
                  <UserAvatar
                    path={people[row.user_id]?.avatar_url}
                    name={people[row.user_id]?.full_name ?? "Student"}
                    className="size-10"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {people[row.user_id]?.full_name ?? "Student"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {TIER_LIMITS[row.tier].label} · KES {row.amount} · {timeAgo(row.created_at)}
                    </p>
                  </div>
                  <Badge variant="secondary" className="ml-auto font-mono">
                    {row.mpesa_code}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Paid by {row.payer_name}</p>
                <div className="mt-3 flex gap-2">
                  <Button className="min-h-11" onClick={() => void decidePayment(row, true)}>
                    Approve
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    onClick={() =>
                      void decidePayment(row, false, window.prompt("Reason?") ?? undefined)
                    }
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="mentors" className="space-y-3">
            {apps.length === 0 && (
              <p className="text-sm text-muted-foreground">No pending applications.</p>
            )}
            {apps.map((row) => (
              <div key={row.id} className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-center gap-3">
                  <UserAvatar
                    path={people[row.user_id]?.avatar_url}
                    name={people[row.user_id]?.full_name ?? "Student"}
                    className="size-10"
                  />
                  <div>
                    <p className="text-sm font-semibold">
                      {people[row.user_id]?.full_name ?? "Student"}
                    </p>
                    <p className="text-xs text-muted-foreground">{row.expertise}</p>
                  </div>
                </div>
                <p className="mt-2 text-sm">{row.experience}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Available: {row.availability}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button className="min-h-11" onClick={() => void decideMentor(row, true)}>
                    Approve
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    onClick={() => void decideMentor(row, false)}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="reports" className="space-y-3">
            {reports.length === 0 && (
              <p className="text-sm text-muted-foreground">Nothing reported.</p>
            )}
            {reports.map((row) => (
              <div key={row.id} className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold capitalize">{row.target_type} reported</p>
                  <Badge
                    variant={row.status === "pending" ? "secondary" : "outline"}
                    className="capitalize"
                  >
                    {row.status === "approved" ? "actioned" : row.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  by {people[row.reporter_id]?.full_name ?? "Student"} · {timeAgo(row.created_at)}
                </p>
                <p className="mt-2 text-sm">{row.reason}</p>
                {row.target_type === "post" && (
                  <Link
                    to="/p/$id"
                    params={{ id: row.target_id }}
                    className="mt-2 inline-block text-sm font-medium text-primary hover:underline"
                  >
                    Open the reported post
                  </Link>
                )}
                {row.target_type === "user" && (
                  <Link
                    to="/u/$id"
                    params={{ id: row.target_id }}
                    className="mt-2 inline-block text-sm font-medium text-primary hover:underline"
                  >
                    Open the reported profile
                  </Link>
                )}
                {row.status === "pending" && (
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="destructive"
                      className="min-h-11"
                      onClick={() => void resolveReport(row, true)}
                    >
                      {row.target_type === "user" ? "Ban user" : "Remove content"}
                    </Button>
                    <Button
                      variant="outline"
                      className="min-h-11"
                      onClick={() => void resolveReport(row, false)}
                    >
                      Dismiss
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </TabsContent>

        </Tabs>
      )}
    </div>
  );
}
