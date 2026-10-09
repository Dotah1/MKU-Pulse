import { useCallback, useEffect, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Check, GraduationCap, Loader2, MessageCircle, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { notify } from "@/lib/notify";
import { useCampus } from "@/hooks/useCampus";
import { UserAvatar } from "@/components/StoredMedia";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { sanitizeText } from "@/lib/campus";
import { fetchProfiles, getOrCreateConversation, type MiniProfile } from "@/lib/campus-data";

export const Route = createFileRoute("/_authenticated/mentorship")({
  head: () => ({
    meta: [
      { title: "Mentorship — MKU Pulse" },
      {
        name: "description",
        content: "Browse approved campus mentors, book sessions and chat — free for every student.",
      },
      { property: "og:title", content: "Mentorship — MKU Pulse" },
      { property: "og:description", content: "Find a campus mentor on MKU Pulse." },
    ],
  }),
  component: MentorshipPage,
});

interface MentorRow {
  user_id: string;
  expertise: string;
  availability: string;
  experience: string;
  rating: number;
  rating_count: number;
  mentorship_areas: string[];
}

const MENTORSHIP_AREAS = [
  "Academic Guidance",
  "Study Skills and Exam Preparation",
  "Research and Academic Writing",
  "Career Guidance",
  "Clinical and Professional Development",
  "Leadership and Student Organizations",
  "Entrepreneurship and Business",
  "Campus Life and Student Adjustment",
  "Other",
] as const;

interface ApplicationRow {
  id: string;
  status: "pending" | "approved" | "rejected";
  admin_note: string | null;
  created_at: string;
}

function MentorshipPage() {
  const { user } = useCampus();
  const navigate = useNavigate();
  const [mentors, setMentors] = useState<MentorRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, MiniProfile>>({});
  const [application, setApplication] = useState<ApplicationRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [area, setArea] = useState<string | null>(null);
  const [verifiedIds, setVerifiedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("mentors")
      .select(
        "user_id, expertise, availability, experience, rating, rating_count, mentorship_areas",
      )
      .order("rating", { ascending: false });
    const rows = (data ?? []) as MentorRow[];
    setMentors(rows);
    const [profileMap, verification] = await Promise.all([
      fetchProfiles(rows.map((r) => r.user_id)),
      rows.length > 0
        ? supabase
            .from("profiles")
            .select("id, mku_verified")
            .in(
              "id",
              rows.map((r) => r.user_id),
            )
        : Promise.resolve({ data: [] as { id: string; mku_verified: boolean }[] }),
    ]);
    setProfiles(profileMap);
    setVerifiedIds(
      new Set((verification.data ?? []).filter((p) => p.mku_verified).map((p) => p.id)),
    );

    if (user) {
      const { data: app } = await supabase
        .from("mentor_applications")
        .select("id, status, admin_note, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      setApplication((app as ApplicationRow | null) ?? null);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = mentors.filter((m) => {
    const p = profiles[m.user_id];
    const hay = `${p?.full_name ?? ""} ${m.expertise} ${p?.major ?? ""}`.toLowerCase();
    return hay.includes(query.trim().toLowerCase()) && (!area || m.mentorship_areas.includes(area));
  });

  const message = async (mentorId: string) => {
    if (!user) return;
    try {
      const id = await getOrCreateConversation(user.id, mentorId);
      void navigate({
        to: "/messages",
        search: {
          c: id,
          p: undefined,
          notification_event: undefined,
          notification_kind: undefined,
        },
      });
    } catch {
      toast.error("Could not open that chat");
    }
  };

  const requestSession = async (mentorId: string) => {
    if (!user) return;
    const topic = window.prompt("What would you like help with?");
    if (!topic) return;
    const { data: session, error } = await supabase
      .from("mentor_sessions")
      .insert({
        mentor_id: mentorId,
        student_id: user.id,
        topic: sanitizeText(topic, 200),
        scheduled_at: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .select("id")
      .single();
    if (error || !session) toast.error(error?.message ?? "Could not request a mentorship session");
    else {
      toast.success("Session request sent to your mentor");
      void notify({
        recipientIds: mentorId,
        title: "New mentorship request",
        body: sanitizeText(topic, 120),
        url: "/mentorship",
        kind: "mentorship",
        eventId: session.id,
      });
    }
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-2xl font-bold">Mentorship</h1>
        <p className="text-sm text-muted-foreground">Free for every student, on every plan.</p>
      </header>

      <div>
        <Label htmlFor="mentor-q" className="sr-only">
          Search mentors
        </Label>
        <Input
          id="mentor-q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, expertise or department"
          className="min-h-11"
        />
      </div>

      <div
        className="flex gap-2 overflow-x-auto pb-1"
        role="group"
        aria-label="Filter mentors by area"
      >
        <Button
          type="button"
          variant={area === null ? "default" : "outline"}
          className="min-h-10 shrink-0 rounded-full"
          onClick={() => setArea(null)}
        >
          All Mentors
        </Button>
        {MENTORSHIP_AREAS.map((item) => (
          <Button
            key={item}
            type="button"
            variant={area === item ? "default" : "outline"}
            className="min-h-10 shrink-0 rounded-full"
            onClick={() => setArea(item)}
          >
            {item}
          </Button>
        ))}
      </div>

      {loading ? (
        <Loader2 className="mx-auto my-12 size-6 animate-spin text-muted-foreground" />
      ) : filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {area
            ? `No mentors are listed for ${area} yet.`
            : "No mentors listed yet. Applications are reviewed by the admin team."}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {filtered.map((m) => {
            const p = profiles[m.user_id];
            return (
              <article key={m.user_id} className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-center gap-3">
                  <Link to="/u/$id" params={{ id: m.user_id }} aria-label="View mentor profile">
                    <UserAvatar
                      path={p?.avatar_url}
                      name={p?.full_name ?? "Mentor"}
                      className="size-12"
                    />
                  </Link>
                  <div className="min-w-0">
                    <Link to="/u/$id" params={{ id: m.user_id }}>
                      <h2 className="truncate font-display text-base font-semibold hover:underline">
                        {p?.full_name ?? "Mentor"}
                      </h2>
                    </Link>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Star className="size-3 fill-accent text-accent" aria-hidden="true" />
                      {m.rating.toFixed(1)} ({m.rating_count})
                    </p>
                    {verifiedIds.has(m.user_id) && (
                      <Badge variant="secondary" className="mt-1 gap-1 text-[10px]">
                        <Check className="size-3" aria-hidden="true" /> Verified MKU Student
                      </Badge>
                    )}
                  </div>
                </div>
                <p className="mt-3 text-sm font-medium">{m.expertise}</p>
                {m.mentorship_areas.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {m.mentorship_areas.map((item) => (
                      <Badge key={item} variant="outline" className="text-[10px]">
                        {item}
                      </Badge>
                    ))}
                  </div>
                )}
                <p className="mt-1 text-sm text-muted-foreground">{m.experience}</p>
                <Badge variant="secondary" className="mt-2">
                  {m.availability || "Flexible"}
                </Badge>
                <div className="mt-4 flex gap-2">
                  {m.user_id !== user?.id && (
                    <Button className="min-h-11 flex-1" onClick={() => void message(m.user_id)}>
                      <MessageCircle className="mr-2 size-4" aria-hidden="true" />
                      Message
                    </Button>
                  )}
                  {m.user_id === user?.id ? (
                    <Button variant="outline" className="min-h-11 flex-1" disabled>
                      This is your mentor profile
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      className="min-h-11 flex-1"
                      onClick={() => void requestSession(m.user_id)}
                    >
                      Request session
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <IncomingRequests />

      <MentorApplication existing={application} onSubmitted={() => void load()} />
    </div>
  );
}

function MentorApplication({
  existing,
  onSubmitted,
}: {
  existing: ApplicationRow | null;
  onSubmitted: () => void;
}) {
  const { user } = useCampus();
  const [expertise, setExpertise] = useState("");
  const [availability, setAvailability] = useState("");
  const [experience, setExperience] = useState("");
  const [areas, setAreas] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (areas.length === 0) {
      toast.error("Select at least one mentorship area");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("mentor_applications").insert({
      user_id: user.id,
      expertise: sanitizeText(expertise, 200),
      availability: sanitizeText(availability, 200),
      experience: sanitizeText(experience, 1000),
      mentorship_areas: areas,
      status: "pending",
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Application submitted for review");
    setExpertise("");
    setAvailability("");
    setExperience("");
    setAreas([]);
    onSubmitted();
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold">
        <GraduationCap className="size-5 text-primary" aria-hidden="true" />
        Become a mentor
      </h2>

      {existing && existing.status === "pending" ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Your application is under review. We'll notify you once the admin team decides.
        </p>
      ) : existing && existing.status === "approved" ? (
        <p className="mt-2 text-sm text-success">
          You're an approved mentor — students can now find you in the directory.
        </p>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-3">
          {existing?.status === "rejected" && (
            <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              Previous application declined{existing.admin_note ? `: ${existing.admin_note}` : ""}.
              You can apply again.
            </p>
          )}
          <div>
            <Label htmlFor="m-exp">Area of expertise</Label>
            <Input
              id="m-exp"
              required
              value={expertise}
              onChange={(e) => setExpertise(e.target.value)}
              className="mt-1 min-h-11"
            />
          </div>
          <div>
            <Label htmlFor="m-avail">Availability</Label>
            <Input
              id="m-avail"
              required
              placeholder="e.g. Weekday evenings"
              value={availability}
              onChange={(e) => setAvailability(e.target.value)}
              className="mt-1 min-h-11"
            />
          </div>
          <div>
            <Label>Mentorship areas</Label>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {MENTORSHIP_AREAS.map((area) => (
                <label
                  key={area}
                  className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-xs hover:bg-secondary"
                >
                  <Checkbox
                    checked={areas.includes(area)}
                    onCheckedChange={() =>
                      setAreas((current) =>
                        current.includes(area)
                          ? current.filter((item) => item !== area)
                          : [...current, area],
                      )
                    }
                  />
                  {area}
                </label>
              ))}
            </div>
          </div>
          <div>
            <Label htmlFor="m-story">Relevant experience</Label>
            <Textarea
              id="m-story"
              required
              rows={4}
              maxLength={1000}
              value={experience}
              onChange={(e) => setExperience(e.target.value)}
              className="mt-1"
            />
          </div>
          <Button type="submit" disabled={busy} className="min-h-11">
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
            Submit application
          </Button>
        </form>
      )}
    </section>
  );
}

interface SessionRequestRow {
  id: string;
  student_id: string;
  topic: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
}

/** Requests students have sent to me as a mentor. */
function IncomingRequests() {
  const { user } = useCampus();
  const navigate = useNavigate();
  const [rows, setRows] = useState<SessionRequestRow[]>([]);
  const [people, setPeople] = useState<Record<string, MiniProfile>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("mentor_sessions")
      .select("id, student_id, topic, status, created_at")
      .eq("mentor_id", user.id)
      .order("created_at", { ascending: false });
    const list = (data ?? []) as SessionRequestRow[];
    setRows(list);
    setPeople(await fetchProfiles(list.map((r) => r.student_id)));
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`mentor-requests-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "mentor_sessions",
          filter: `mentor_id=eq.${user.id}`,
        },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, load]);

  const openChat = async (row: SessionRequestRow) => {
    if (!user) return;
    try {
      const id = await getOrCreateConversation(user.id, row.student_id);
      if (row.status === "pending") {
        const { error } = await supabase
          .from("mentor_sessions")
          .update({ status: "approved" })
          .eq("id", row.id);
        if (error) {
          toast.error(error.message);
          return;
        }
        setRows((prev) =>
          prev.map((r) => (r.id === row.id ? { ...r, status: "approved" as const } : r)),
        );
        void notify({
          recipientIds: row.student_id,
          title: "Mentor accepted your request",
          body: "Your mentor is ready to chat about your session request.",
          url: `/messages?c=${id}`,
          kind: "mentorship",
          eventId: row.id,
        });
      }
      void navigate({
        to: "/messages",
        search: {
          c: id,
          p: undefined,
          notification_event: undefined,
          notification_kind: undefined,
        },
      });
    } catch {
      toast.error("Could not open that chat");
    }
  };

  if (loading || rows.length === 0) return null;
  const pending = rows.filter((r) => r.status === "pending").length;

  // One line per student: repeat requests are counted instead of repeated.
  const grouped = rows.reduce<{ latest: SessionRequestRow; count: number; pending: number }[]>(
    (acc, r) => {
      const found = acc.find((g) => g.latest.student_id === r.student_id);
      if (found) {
        found.count += 1;
        if (r.status === "pending") found.pending += 1;
        return acc;
      }
      acc.push({ latest: r, count: 1, pending: r.status === "pending" ? 1 : 0 });
      return acc;
    },
    [],
  );

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold">
        <MessageCircle className="size-5 text-primary" aria-hidden="true" />
        Requests for you
        {pending > 0 && <Badge>{pending} new</Badge>}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Students who asked you for help. Tap one to reply in a chat.
      </p>
      <ul className="mt-4 space-y-2">
        {grouped.map((g) => {
          const r = g.latest;
          const p = people[r.student_id];
          return (
            <li key={r.student_id}>
              <button
                type="button"
                onClick={() => void openChat(r)}
                className="flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left hover:bg-secondary"
              >
                <UserAvatar path={p?.avatar_url} name={p?.full_name ?? "Student"} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{p?.full_name ?? "Student"}</span>
                  <span className="block truncate text-sm text-muted-foreground">{r.topic}</span>
                  {g.count > 1 && (
                    <span className="block text-xs text-muted-foreground">
                      {g.count} requests sent
                    </span>
                  )}
                </span>
                {g.pending > 0 ? (
                  <Badge variant="secondary">New</Badge>
                ) : (
                  <Badge variant="outline" className="capitalize">
                    {r.status}
                  </Badge>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
