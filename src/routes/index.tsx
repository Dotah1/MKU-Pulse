import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Heart, MessageCircle, GraduationCap, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MKU Pulse — Meet, match & mentor on campus" },
      {
        name: "description",
        content:
          "Join your campus feed, match with students, find mentors and chat in real time. Gmail sign-up only.",
      },
      { property: "og:title", content: "MKU Pulse — Meet, match & mentor on campus" },
      {
        property: "og:description",
        content: "The campus social network: feed, matching, mentorship and real-time chat.",
      },
    ],
  }),
  component: Landing,
});

const FEATURES = [
  {
    icon: Users,
    title: "Campus feed",
    body: "Share text, photos and short clips with your campus.",
  },
  {
    icon: Heart,
    title: "Connect",
    body: "Swipe through real student profiles and match instantly.",
  },
  {
    icon: GraduationCap,
    title: "Mentorship",
    body: "Free for everyone — find and book campus mentors.",
  },
  {
    icon: MessageCircle,
    title: "Real-time chat",
    body: "Typing indicators, read receipts and push alerts.",
  },
];

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
        <span className="font-display text-lg font-bold">
          MKU<span className="text-primary">Pulse</span>
        </span>
        <Button asChild variant="ghost" className="min-h-11">
          <Link to="/auth" search={{ mode: "signin" }}>
            Sign in
          </Link>
        </Button>
      </header>

      <section className="mx-auto max-w-3xl px-4 pt-12 pb-16 text-center">
        <p className="mb-4 inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
          Built for university students
        </p>
        <h1 className="font-display text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
          Your whole campus life, in one app.
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base text-muted-foreground sm:text-lg">
          A social feed, student matching, free mentorship and real-time messaging — all in MKU
          Pulse.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Button asChild size="lg" className="min-h-12 px-8">
            <Link to="/auth" search={{ mode: "signup" }}>
              Create your account
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="min-h-12 px-8">
            <Link to="/auth" search={{ mode: "signin" }}>
              I already have one
            </Link>
          </Button>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-4 px-4 pb-20 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-2xl border border-border bg-card p-5">
            <f.icon className="size-6 text-primary" aria-hidden="true" />
            <h2 className="mt-3 font-display text-base font-semibold">{f.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{f.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
