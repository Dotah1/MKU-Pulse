import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "@/lib/toast";
import { Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MKU_INBOX, requestMkuCode } from "@/lib/mku-verify.functions";

export function MkuVerifyCard({ verified }: { verified: boolean }) {
  const request = useServerFn(requestMkuCode);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);

  if (verified) {
    return (
      <section className="rounded-2xl border border-border bg-card p-4 text-sm font-semibold text-primary">
        ✓ Verified MKU Student
      </section>
    );
  }

  const get = async () => {
    setBusy(true);
    try {
      const r = await request({ data: { email } });
      setCode(r.code);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not get a code");
    } finally {
      setBusy(false);
    }
  };

  const mailto = code
    ? `mailto:${MKU_INBOX}?subject=${encodeURIComponent(code)}&body=${encodeURIComponent(`My MKU Pulse verification code: ${code}`)}`
    : "#";

  return (
    <section
      className="space-y-3 rounded-2xl border border-border bg-card p-4"
      aria-label="MKU verification"
    >
      <div>
        <h2 className="font-semibold">Get the Verified MKU Student badge</h2>
        <p className="text-xs text-muted-foreground">
          Prove you're an MKU student with your school email.
        </p>
      </div>
      {!code ? (
        <div className="flex min-w-0 gap-2">
          <Input
            type="email"
            placeholder="you@mylife.mku.ac.ke"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="min-w-0 flex-1"
          />
          <Button className="min-h-11 shrink-0" onClick={get} disabled={busy || !email}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : "Get code"}
          </Button>
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between rounded-xl bg-secondary px-3 py-2">
            <span className="min-w-0 break-words font-mono text-lg font-bold tracking-widest">
              {code}
            </span>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Copy code"
              onClick={() =>
                void navigator.clipboard.writeText(code).then(() => toast.success("Copied"))
              }
            >
              <Copy className="size-4" />
            </Button>
          </div>
          <p className="break-words text-muted-foreground">
            From <b>{email}</b>, send this code to <b>{MKU_INBOX}</b> (put it in the subject). We'll
            verify you within a day. The code works for 7 days and only for your account.
          </p>
          <Button asChild className="w-full">
            <a href={mailto}>Open email app</a>
          </Button>
        </div>
      )}
    </section>
  );
}
