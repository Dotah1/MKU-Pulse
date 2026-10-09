import { useEffect, useState } from "react";
import { Ban, Flag, MoreVertical, UserMinus } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  REPORT_CATEGORIES,
  blockUser,
  iBlocked,
  reportUser,
  unblockUser,
  unmatchUser,
} from "@/lib/blocks";

interface Props {
  me: string;
  other: string;
  name?: string | undefined;
  allowUnmatch?: boolean;
  onChange?: (state: "blocked" | "unblocked" | "unmatched") => void;
}

export function SafetyMenu({ me, other, name: rawName, allowUnmatch, onChange }: Props) {
  const name = rawName || "this student";
  const [blocked, setBlocked] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [category, setCategory] = useState<string>(REPORT_CATEGORIES[0]);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void iBlocked(me, other).then(setBlocked);
  }, [me, other]);

  const toggleBlock = async () => {
    try {
      if (blocked) {
        await unblockUser(me, other);
        setBlocked(false);
        toast.success(`${name} unblocked`);
        onChange?.("unblocked");
      } else {
        if (!window.confirm(`Block ${name}? You won't be able to message or match each other.`))
          return;
        await blockUser(me, other);
        setBlocked(true);
        toast.success(`${name} blocked`);
        onChange?.("blocked");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  const unmatch = async () => {
    if (!window.confirm(`Remove your connection with ${name}?`)) return;
    try {
      await unmatchUser(me, other);
      toast.success("Connection removed");
      onChange?.("unmatched");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove connection");
    }
  };

  const submitReport = async () => {
    setBusy(true);
    try {
      await reportUser(me, other, category, details);
      toast.success("Report sent to the MKU Pulse team");
      setReportOpen(false);
      setDetails("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send report");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="min-h-11 min-w-11" aria-label="Safety options">
            <MoreVertical className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {allowUnmatch && (
            <DropdownMenuItem className="min-h-11" onClick={() => void unmatch()}>
              <UserMinus className="mr-2 size-4" /> Remove connection
            </DropdownMenuItem>
          )}
          <DropdownMenuItem className="min-h-11" onClick={() => setReportOpen(true)}>
            <Flag className="mr-2 size-4" /> Report
          </DropdownMenuItem>
          <DropdownMenuItem className="min-h-11 text-destructive" onClick={() => void toggleBlock()}>
            <Ban className="mr-2 size-4" /> {blocked ? "Unblock" : "Block"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report {name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {REPORT_CATEGORIES.map((c) => (
              <label key={c} className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3">
                <input
                  type="radio"
                  name="report-category"
                  checked={category === c}
                  onChange={() => setCategory(c)}
                />
                <span className="text-sm">{c}</span>
              </label>
            ))}
            <textarea
              className="min-h-20 w-full rounded-lg border border-border bg-background p-3 text-sm"
              placeholder="Add details (optional)"
              maxLength={500}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button className="min-h-11" disabled={busy} onClick={() => void submitReport()}>
              Send report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
