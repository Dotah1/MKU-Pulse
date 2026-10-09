import { useCallback, useEffect, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { CalendarDays, Clock3, Loader2, MapPin, Plus } from "lucide-react";
import { toast } from "@/lib/toast";
import { supabase } from "@/integrations/supabase/client";
import { useCampus } from "@/hooks/useCampus";
import { isExpired, sanitizeText } from "@/lib/campus";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const DAY_MS = 24 * 60 * 60 * 1000;
const EVENT_PAGE_SIZE = 50;

const EVENT_CATEGORIES = [
  { value: "social", label: "Social" },
  { value: "academic", label: "Academic" },
  { value: "career", label: "Career" },
  { value: "sports", label: "Sports" },
  { value: "club", label: "Club or society" },
  { value: "other", label: "Other" },
] as const;

type EventCategory = (typeof EVENT_CATEGORIES)[number]["value"];

interface CampusEvent {
  id: string;
  title: string;
  description: string | null;
  category: string;
  location: string;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
}

interface EventForm {
  title: string;
  description: string;
  category: EventCategory;
  location: string;
  startsAt: string;
  endsAt: string;
}

function emptyEventForm(): EventForm {
  return {
    title: "",
    description: "",
    category: "social",
    location: "",
    startsAt: "",
    endsAt: "",
  };
}

function toLocalDateTimeValue(date: Date): string {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function formatEventDate(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function categoryLabel(category: string): string {
  return EVENT_CATEGORIES.find((item) => item.value === category)?.label ?? "Campus event";
}

export const Route = createFileRoute("/_authenticated/events")({
  head: () => ({
    meta: [
      { title: "Campus Events — MKU Pulse" },
      {
        name: "description",
        content: "Discover upcoming events and meetups happening around the MKU campus.",
      },
      { property: "og:title", content: "Campus Events — MKU Pulse" },
      { property: "og:description", content: "Discover what is happening around campus." },
    ],
  }),
  component: EventsPage,
});

function EventsPage() {
  const { user, profile, loading: campusLoading } = useCampus();
  const [events, setEvents] = useState<CampusEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [form, setForm] = useState<EventForm>(emptyEventForm);
  const [creating, setCreating] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<string | null>(null);

  const userId = user?.id ?? null;
  const loadEvents = useCallback(async () => {
    if (!userId) {
      setEventsLoading(false);
      return;
    }
    setEventsLoading(true);
    try {
      const cutoff = new Date(Date.now() - DAY_MS).toISOString();
      const [eventResult, recentEventResult] = await Promise.all([
        supabase
          .from("campus_events")
          .select("id, title, description, category, location, starts_at, ends_at, created_at")
          .gte("starts_at", new Date().toISOString())
          .order("starts_at", { ascending: true })
          .limit(EVENT_PAGE_SIZE),
        supabase
          .from("campus_events")
          .select("created_at")
          .eq("creator_id", userId)
          .gte("created_at", cutoff)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (eventResult.error) throw eventResult.error;
      if (recentEventResult.error) throw recentEventResult.error;
      setEvents((eventResult.data ?? []) as CampusEvent[]);
      setCooldownUntil(
        recentEventResult.data?.created_at
          ? new Date(new Date(recentEventResult.data.created_at).getTime() + DAY_MS).toISOString()
          : null,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load campus events");
    } finally {
      setEventsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    if (!cooldownUntil) return;
    const delay = new Date(cooldownUntil).getTime() - Date.now() + 250;
    if (delay <= 0) {
      void loadEvents();
      return;
    }
    const timer = window.setTimeout(() => void loadEvents(), delay);
    return () => window.clearTimeout(timer);
  }, [cooldownUntil, loadEvents]);

  const hasActivePaidPlan = Boolean(
    profile && profile.tier !== "free" && !isExpired(profile.tier_expires_at),
  );
  const isCoolingDown = cooldownUntil !== null && new Date(cooldownUntil).getTime() > Date.now();

  const createEvent = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !profile) return;
    if (!hasActivePaidPlan) {
      toast.error("Event creation is available to active paid plans only.");
      return;
    }
    if (profile.is_banned) {
      toast.error("Your account is restricted from creating events.");
      return;
    }
    if (isCoolingDown) {
      toast.error("You can create only one event in any 24-hour period.");
      return;
    }

    const title = sanitizeText(form.title, 120).trim();
    const location = sanitizeText(form.location, 160).trim();
    const description = sanitizeText(form.description, 1500).trim();
    const startsAt = new Date(form.startsAt);
    const endsAt = form.endsAt ? new Date(form.endsAt) : null;

    if (title.length < 3) {
      toast.error("Event title must be at least 3 characters.");
      return;
    }
    if (location.length < 2) {
      toast.error("Add a location for the event.");
      return;
    }
    if (
      !form.startsAt ||
      !Number.isFinite(startsAt.getTime()) ||
      startsAt.getTime() <= Date.now()
    ) {
      toast.error("Choose a future event start time.");
      return;
    }
    if (endsAt && (!Number.isFinite(endsAt.getTime()) || endsAt.getTime() <= startsAt.getTime())) {
      toast.error("Event end time must be after its start time.");
      return;
    }

    setCreating(true);
    try {
      const { error } = await supabase.rpc("create_campus_event", {
        p_title: title,
        p_description: description || null,
        p_category: form.category,
        p_location: location,
        p_starts_at: startsAt.toISOString(),
        p_ends_at: endsAt?.toISOString() ?? null,
      });
      if (error) throw error;
      toast.success("Your campus event is published.");
      setForm(emptyEventForm());
      await loadEvents();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not publish your event");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <CalendarDays className="size-6 text-primary" aria-hidden="true" />
          <h1 className="font-display text-2xl font-bold">Campus Events</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Find out what is happening around campus and share the next thing students should show up
          for.
        </p>
      </header>

      {!profile ? (
        <div className="rounded-2xl border border-border p-6 text-sm text-muted-foreground">
          {campusLoading ? "Loading your campus profile…" : "Your campus profile is not available."}
        </div>
      ) : profile.is_banned ? (
        <div className="rounded-2xl border border-border bg-muted/40 p-5 text-sm text-muted-foreground">
          Your account is restricted from creating campus events. You can still browse upcoming
          events.
        </div>
      ) : !hasActivePaidPlan ? (
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 sm:p-6">
          <h2 className="font-semibold">Create an event with a paid plan</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Event publishing is included with an active Campus Socialite or Campus VIP plan. You can
            create one event in any rolling 24-hour period. Everyone can browse campus events.
          </p>
          <Button asChild className="mt-4">
            <Link to="/profile">View plans</Link>
          </Button>
        </div>
      ) : isCoolingDown ? (
        <div className="rounded-2xl border border-border bg-muted/40 p-5 sm:p-6">
          <h2 className="font-semibold">Your next event slot is coming up</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            You can publish another event after {new Date(cooldownUntil).toLocaleString()}. The
            limit is one event in any rolling 24-hour period.
          </p>
        </div>
      ) : (
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
          <div className="mb-5">
            <h2 className="flex items-center gap-2 font-semibold">
              <Plus className="size-4 text-primary" aria-hidden="true" /> Create a campus event
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Active paid members can publish one event every 24 hours.
            </p>
          </div>
          <form className="space-y-4" onSubmit={(event) => void createEvent(event)}>
            <div className="space-y-2">
              <Label htmlFor="event-title">Event name</Label>
              <Input
                id="event-title"
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                maxLength={120}
                minLength={3}
                placeholder="e.g. Saturday football meetup"
                required
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="event-category">Category</Label>
                <select
                  id="event-category"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={form.category}
                  onChange={(event) =>
                    setForm({ ...form, category: event.target.value as EventCategory })
                  }
                >
                  {EVENT_CATEGORIES.map((category) => (
                    <option key={category.value} value={category.value}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="event-location">Location</Label>
                <Input
                  id="event-location"
                  value={form.location}
                  onChange={(event) => setForm({ ...form, location: event.target.value })}
                  maxLength={160}
                  minLength={2}
                  placeholder="e.g. Main campus auditorium"
                  required
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="event-start">Starts</Label>
                <Input
                  id="event-start"
                  type="datetime-local"
                  min={toLocalDateTimeValue(new Date())}
                  value={form.startsAt}
                  onChange={(event) => setForm({ ...form, startsAt: event.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="event-end">Ends (optional)</Label>
                <Input
                  id="event-end"
                  type="datetime-local"
                  min={form.startsAt || toLocalDateTimeValue(new Date())}
                  value={form.endsAt}
                  onChange={(event) => setForm({ ...form, endsAt: event.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="event-description">Details (optional)</Label>
              <Textarea
                id="event-description"
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                maxLength={1500}
                rows={4}
                placeholder="What should students know before they come?"
              />
            </div>

            <Button type="submit" disabled={creating || eventsLoading}>
              {creating || eventsLoading ? (
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="mr-2 size-4" aria-hidden="true" />
              )}
              {creating ? "Publishing…" : "Publish event"}
            </Button>
          </form>
        </section>
      )}

      <section className="space-y-4" aria-labelledby="upcoming-events-heading">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 id="upcoming-events-heading" className="font-display text-xl font-bold">
              Upcoming events
            </h2>
            <p className="text-sm text-muted-foreground">Open to everyone on MKU Pulse.</p>
          </div>
          {!eventsLoading && (
            <span className="text-sm text-muted-foreground">
              {events.length} {events.length === 1 ? "event" : "events"}
            </span>
          )}
        </div>

        {eventsLoading ? (
          <div className="flex justify-center py-12" role="status" aria-label="Loading events">
            <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
          </div>
        ) : events.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center">
            <CalendarDays
              className="mx-auto mb-3 size-8 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="font-medium">Nothing scheduled yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Be the first to share an upcoming campus event.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {events.map((event) => (
              <article
                key={event.id}
                className="min-w-0 space-y-3 rounded-2xl border border-border p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                    {categoryLabel(event.category)}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {event.created_at
                      ? `Posted ${new Date(event.created_at).toLocaleDateString()}`
                      : ""}
                  </span>
                </div>
                <h3 className="break-words [overflow-wrap:anywhere] font-display text-lg font-semibold">
                  {event.title}
                </h3>
                {event.description && (
                  <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                    {event.description}
                  </p>
                )}
                <div className="space-y-2 border-t border-border pt-3 text-sm">
                  <p className="flex items-start gap-2">
                    <Clock3 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                    <span>
                      {formatEventDate(event.starts_at)}
                      {event.ends_at ? ` – ${formatEventDate(event.ends_at)}` : ""}
                    </span>
                  </p>
                  <p className="flex items-start gap-2">
                    <MapPin className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                    <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                      {event.location}
                    </span>
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
