import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, Download, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const FIRST_VISIT_KEY = "mku-pulse-install-intro-seen-v1";

export function FirstVisitInstall({ children }: { children: ReactNode }) {
  const [showIntro, setShowIntro] = useState(false);
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [android, setAndroid] = useState(false);

  useEffect(() => {
    try {
      setShowIntro(window.localStorage.getItem(FIRST_VISIT_KEY) !== "1");
    } catch {
      setShowIntro(false);
    }

    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const isAppleMobile =
      /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    setIos(isAppleMobile && !isStandalone);
    setAndroid(/android/i.test(navigator.userAgent) && !isStandalone);

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallEvent(null);
      markSeen();
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const markSeen = () => {
    setShowIntro(false);
    try {
      window.localStorage.setItem(FIRST_VISIT_KEY, "1");
    } catch {
      // Continue even when storage is blocked.
    }
  };

  const install = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    setInstallEvent(null);
    if (choice.outcome === "accepted") markSeen();
  };

  if (!showIntro) return <>{children}</>;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <section className="w-full max-w-md rounded-3xl border border-border bg-card p-6 text-center shadow-xl sm:p-8">
        <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Smartphone className="size-8" aria-hidden="true" />
        </div>
        <p className="mt-5 text-sm font-semibold text-primary">MADE FOR MKU STUDENTS</p>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight">
          Your campus, one tap away.
        </h1>
        <p className="mt-3 text-muted-foreground">
          Install MKU Pulse for a full-screen app experience and quick access to campus updates,
          connections, mentorship and chat.
        </p>
        {android && (
          <>
            <Button asChild size="lg" className="mt-6 min-h-12 w-full">
              <a href="/downloads/MKUPulse.apk" download="MKUPulse.apk" onClick={markSeen}>
                <Download className="mr-2 size-4" aria-hidden="true" />
                Download Android app (APK)
              </a>
            </Button>
            <p className="mt-2 text-left text-xs text-muted-foreground">
              When the download finishes, open MKUPulse.apk and confirm the Android installation.
              Android may ask you to allow installs from your browser.
            </p>
          </>
        )}
        {installEvent ? (
          <Button
            type="button"
            size="lg"
            variant={android ? "outline" : "default"}
            className={android ? "mt-3 min-h-12 w-full" : "mt-6 min-h-12 w-full"}
            onClick={() => void install()}
          >
            <Smartphone className="mr-2 size-4" aria-hidden="true" />
            Install from browser
          </Button>
        ) : (
          !android && (
            <div className="mt-6 rounded-xl bg-muted/60 p-4 text-left text-sm text-muted-foreground">
              {ios ? (
                <p>
                  In Safari, tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.
                </p>
              ) : (
                <p>
                  To install, open this page in Chrome and use the browser menu’s{" "}
                  <strong>Install app</strong> or <strong>Add to Home screen</strong> option.
                </p>
              )}
            </div>
          )
        )}
        <Button type="button" variant="ghost" className="mt-3 min-h-11 w-full" onClick={markSeen}>
          Continue in browser <ArrowRight className="ml-2 size-4" aria-hidden="true" />
        </Button>
        <p className="mt-3 text-xs text-muted-foreground">
          You can still use the full website without installing.
        </p>
      </section>
    </main>
  );
}
