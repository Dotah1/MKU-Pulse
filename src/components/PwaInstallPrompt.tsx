import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "mku-pulse-install-dismissed-v1";

function isStandalone() {
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    navigatorWithStandalone.standalone === true
  );
}

export function PwaInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      // The prompt can still work when local storage is unavailable.
    }
    const standalone = isStandalone();
    setInstalled(standalone);
    const appleMobile =
      /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    setIos(appleMobile && !standalone);

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallEvent(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const hidePrompt = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Dismissal is best-effort only.
    }
  };

  const install = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    setInstallEvent(null);
    if (choice.outcome === "accepted") setInstalled(true);
  };

  if (dismissed || installed || (!installEvent && !ios)) return null;

  return (
    <aside
      aria-label="Install MKU Pulse"
      className="fixed inset-x-4 bottom-24 z-[60] mx-auto max-w-md rounded-2xl border border-primary/20 bg-card/95 p-4 shadow-xl backdrop-blur md:bottom-6"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Download className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Install MKU Pulse</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {ios
              ? "In Safari, tap Share, then choose “Add to Home Screen” for a full-screen campus app."
              : "Add the campus feed, matches, mentorship and messages to your home screen."}
          </p>
          <div className="mt-3 flex items-center gap-2">
            {installEvent && (
              <Button type="button" size="sm" onClick={() => void install()}>
                Install app
              </Button>
            )}
            <Button type="button" size="sm" variant="ghost" onClick={hidePrompt}>
              {ios ? "Got it" : "Not now"}
            </Button>
          </div>
        </div>
        <button
          type="button"
          onClick={hidePrompt}
          aria-label="Dismiss install prompt"
          className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
