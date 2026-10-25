import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Heart, MessageCircle, GraduationCap, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FirstVisitInstall } from "@/components/FirstVisitInstall";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MKU Pulse | Mount Kenya University Student App" },
      {
        name: "google-site-verification",
        content: "apGm20aPD_qyHjx1C3s0zdjTbFGxJElNXZtPCM6nvkI",
      },
      {
        name: "description",
        content:
          "MKU Pulse is the campus app for Mount Kenya University students. Meet classmates, find mentors, explore events and opportunities, and follow campus updates.",
      },
      {
        name: "keywords",
        content:
          "MKU Pulse, Mount Kenya University, MKU students, MKU campus app, campus community",
      },
      { property: "og:site_name", content: "MKU Pulse" },
      { property: "og:title", content: "MKU Pulse | Mount Kenya University Student App" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://mku-pulse.vercel.app/" },
      {
        property: "og:image",
        content: "https://mku-pulse.vercel.app/screenshots/mku-pulse-wide.png",
      },
      {
        property: "og:image:alt",
        content: "MKU Pulse, the campus app for Mount Kenya University students",
      },
      {
        property: "og:description",
        content:
          "MKU Pulse is the campus app for Mount Kenya University students. Meet classmates, find mentors, explore events and opportunities, and follow campus updates.",
      },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "MKU Pulse | Mount Kenya University Student App" },
      {
        name: "twitter:description",
        content:
          "MKU Pulse is the campus app for Mount Kenya University students. Meet classmates, find mentors, explore events and opportunities, and follow campus updates.",
      },
      {
        name: "twitter:image",
        content: "https://mku-pulse.vercel.app/screenshots/mku-pulse-wide.png",
      },
    ],
    links: [{ rel: "canonical", href: "https://mku-pulse.vercel.app/" }],
  }),
  component: Landing,
});

const FEATURES = [
  {
    icon: Users,
    title: "Campus updates",
    body: "Announcements, polls, Soko listings, hostels and lost & found in one feed.",
  },
  {
    icon: Heart,
    title: "Connect",
    body: "Meet students across courses and years — with block and report built in.",
  },
  {
    icon: GraduationCap,
    title: "Mentorship",
    body: "Free for everyone — get guidance on academics, careers and campus life.",
  },
  {
    icon: MessageCircle,
    title: "Real-time chat",
    body: "Chat in real time with matches, mentors and classmates.",
  },
];

function Landing() {
  return (
    <FirstVisitInstall>
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
            Made for Mount Kenya University students
          </p>
          <h1 className="font-display text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
            MKU Pulse: The campus app for Mount Kenya University students.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-muted-foreground sm:text-lg">
            Connect with comrades, find a mentor, discover hostels, gigs and deals, and never miss a
            campus update.
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
    </FirstVisitInstall>
  );
}
