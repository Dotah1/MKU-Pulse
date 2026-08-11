import { useCallback, useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { GraduationCap, Loader2, MessageCircle, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCampus } from "@/hooks/useCampus";
import { UserAvatar } from "@/components/StoredMedia";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { sanitizeText } from "@/lib/campus";
import { fetchProfiles, getOrCreateConversation, type MiniProfile } from "@/lib/campus-data";

export const Route = createFileRoute("/_authenticated/mentorship")({
  head: () => ({
    meta: [
      { title: "Mentorship — Campus Connect" },
      {
        name: "description",
        content: "Browse approved campus mentors, book sessions and chat — free for every student.",
      },
      { property: "og:title", content: "Mentorship — Campus Connect" },
      { property: "og:description", content: "Find a campus mentor on Campus Connect." },
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
}

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

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("mentors")
      .select("user_id, expertise, availability, experience, rating, rating_count")
      .order("rating", { ascending: false });
    const rows = (data ?? []) as MentorRow[];
    setMentors(rows);
    setProfiles(await fetchProfiles(rows.map((r) => r.user_id)));

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
  }, [user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = mentors.filter((m) => {
    const p = profiles[m.user_id];
    const hay = `${p?.full_name ?? ""} ${m.expertise} ${p?.major ?? ""}`.toLowerCase();
    return hay.includes(query.trim().toLowerCase());
  });

  const message = async (mentorId: string) => {
    if (!user) return;
    try {
      const id = await getOrCreateConversation(user.id, mentorId);
      void navigate({ to: "/messages", search: { c: id } });
    } catch {
      toast.error("Could not open that chat");
    }
  };

  const requestSession = async (mentorId: string) => {
    if (!user) return;
    const topic = window.prompt("What would you like help with?");
    if (!topic) return;
    const { error } = await supabase.from("mentor_sessions").insert({
      mentor_id: mentorId,
      student_id: user.id,
      topic: sanitizeText(topic, 200),
      scheduled_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    if (error) toast.error(error.message);
    else toast.success("Session request sent to your mentor");
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-2xl font-bold">Mentorship</h1>
        <p className="text-sm text-muted-foreground">
          Free for every student, on every plan.
        </p>
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

      {loading ? (
        <Loader2 className="mx-auto my-12 size-6 animate-spin text-muted-foreground" />
      ) : filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No mentors listed yet. Applications are reviewed by the admin team.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {filtered.map((m) => {
            const p = profiles[m.user_id];
            return (
              <article key={m.user_id} className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-center gap-3">
                  <UserAvatar
                    path={p?.avatar_url}
                    name={p?.full_name ?? "Mentor"}
                    className="size-12"
                  />
                  <div className="min-w-0">
                    <h2 className="truncate font-display text-base font-semibold">
                      {p?.full_name ?? "Mentor"}
                    </h2>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Star className="size-3 fill-accent text-accent" aria-hidden="true" />
                      {m.rating.toFixed(1)} ({m.rating_count})
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-sm font-medium">{m.expertise}</p>
                <p className="mt-1 text-sm text-muted-foreground">{m.experience}</p>
                <Badge variant="secondary" className="mt-2">
                  {m.availability || "Flexible"}
                </Badge>
                <div className="mt-4 flex gap-2">
                  <Button className="min-h-11 flex-1" onClick={() => void message(m.user_id)}>
                    <MessageCircle className="mr-2 size-4" aria-hidden="true" />
                    Message
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-11 flex-1"
                    onClick={() => void requestSession(m.user_id)}
                  >
                    Request session
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}

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
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    const { error } = await supabase.from("mentor_applications").insert({
      user_id: user.id,
      expertise: sanitizeText(expertise, 200),
      availability: sanitizeText(availability, 200),
      experience: sanitizeText(experience, 1000),
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
