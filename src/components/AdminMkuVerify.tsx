import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MKU_INBOX, approveMkuCode, lookupMkuCode } from "@/lib/mku-verify.functions";

type Match = Awaited<ReturnType<typeof lookupMkuCode>>;

export function AdminMkuVerify() {
  const lookup = useServerFn(lookupMkuCode);
  const approve = useServerFn(approveMkuCode);
  const [code, setCode] = useState("");
  const [match, setMatch] = useState<Match | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Open {MKU_INBOX}, check the sender is the same @mylife.mku.ac.ke address shown below, then approve.
      </p>
      <div className="flex gap-2">
        <Input
          placeholder="MKU-AB12CD"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            setMatch(null);
          }}
        />
        <Button disabled={busy || !code} onClick={() => run(async () => setMatch(await lookup({ data: { code } })))}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : "Find"}
        </Button>
      </div>
      {match && (
        <div className="space-y-2 rounded-2xl border border-border bg-card p-4 text-sm">
          <p className="font-semibold">{match.fullName || "Unnamed student"}</p>
          <p className="text-muted-foreground">
            {match.major} {match.year ? `· Year ${match.year}` : ""}
          </p>
          <p>
            Must be sent from: <b>{match.email}</b>
          </p>
          {match.expired && <p className="text-destructive">This code has expired.</p>}
          {match.alreadyVerified ? (
            <p className="font-semibold text-primary">Already verified ✓</p>
          ) : (
            <Button
              disabled={busy || match.expired}
              onClick={() =>
                run(async () => {
                  await approve({ data: { code } });
                  toast.success(`${match.fullName || "Student"} is now verified`);
                  setMatch({ ...match, alreadyVerified: true });
                })
              }
            >
              Verify this account
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
