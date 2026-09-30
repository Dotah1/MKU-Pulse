import { useMemo, useState } from "react";
import { Calculator, ExternalLink, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type Grade = "A" | "B" | "C" | "D" | "E";
type GradeRow = { id: number; unit: string; credits: string; grade: Grade | "" };

const GRADE_POINTS: Record<Grade, number> = { A: 4, B: 3, C: 2, D: 1, E: 0 };
const GRADE_OPTIONS: Grade[] = ["A", "B", "C", "D", "E"];

export function CampusToolsDialog() {
  const [rows, setRows] = useState<GradeRow[]>([{ id: 1, unit: "", credits: "3", grade: "" }]);
  const [nextId, setNextId] = useState(2);

  const result = useMemo(() => {
    const gradedRows = rows.filter((row) => {
      const credits = Number(row.credits);
      return row.grade && Number.isFinite(credits) && credits > 0 && credits <= 60;
    });
    const totalCredits = gradedRows.reduce((total, row) => total + Number(row.credits), 0);
    if (!totalCredits) return null;
    const weightedPoints = gradedRows.reduce(
      (total, row) => total + Number(row.credits) * GRADE_POINTS[row.grade as Grade],
      0,
    );
    return { gpa: weightedPoints / totalCredits, totalCredits };
  }, [rows]);

  const updateRow = (id: number, patch: Partial<Omit<GradeRow, "id">>) => {
    setRows((items) => items.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const addRow = () => {
    setRows((items) => [...items, { id: nextId, unit: "", credits: "3", grade: "" }]);
    setNextId((id) => id + 1);
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" className="min-h-11 shrink-0">
          <Calculator className="mr-2 size-4" aria-hidden="true" />
          Campus Tools
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="size-5 text-primary" aria-hidden="true" />
            Campus Tools
          </DialogTitle>
          <DialogDescription>
            Estimate your GPA from the grades and credit hours shown on your results.
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-3 rounded-xl border border-border bg-card p-3 sm:p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold">GPA / Grade Calculator</h3>
            {result && (
              <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-bold text-primary">
                {result.gpa.toFixed(2)} GPA
              </span>
            )}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_4.75rem_4.5rem_2.5rem] items-center gap-2 text-xs font-medium text-muted-foreground">
            <span>Unit</span>
            <span>Credits</span>
            <span>Grade</span>
            <span className="sr-only">Remove</span>
          </div>
          <div className="space-y-2">
            {rows.map((row, index) => (
              <div
                key={row.id}
                className="grid grid-cols-[minmax(0,1fr)_4.75rem_4.5rem_2.5rem] items-center gap-2"
              >
                <Input
                  value={row.unit}
                  onChange={(event) => updateRow(row.id, { unit: event.target.value })}
                  placeholder={`Unit ${index + 1}`}
                  aria-label={`Unit ${index + 1} name`}
                  className="min-w-0"
                  maxLength={60}
                />
                <Input
                  type="number"
                  min="0.5"
                  max="60"
                  step="0.5"
                  value={row.credits}
                  onChange={(event) => updateRow(row.id, { credits: event.target.value })}
                  aria-label={`Unit ${index + 1} credit hours`}
                />
                <select
                  value={row.grade}
                  onChange={(event) =>
                    updateRow(row.id, { grade: event.target.value as Grade | "" })
                  }
                  aria-label={`Unit ${index + 1} grade`}
                  className="min-h-11 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Grade</option>
                  {GRADE_OPTIONS.map((grade) => (
                    <option key={grade} value={grade}>
                      {grade} · {GRADE_POINTS[grade].toFixed(1)}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={rows.length === 1}
                  onClick={() => setRows((items) => items.filter((item) => item.id !== row.id))}
                  aria-label={`Remove unit ${index + 1}`}
                  className="size-10"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
          <Button type="button" variant="outline" size="sm" className="min-h-10" onClick={addRow}>
            <Plus className="mr-1 size-4" aria-hidden="true" /> Add unit
          </Button>
          <div className="rounded-lg bg-secondary/70 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">
              Estimate only · 4.0 point mapping: A=4, B=3, C=2, D=1, E=0.
            </p>
            <p className="mt-1">
              MKU grading can vary by programme and award. Confirm your official grade scale and
              results in the Student Portal; this calculator does not determine eligibility or
              official standing.
            </p>
            {result && <p className="mt-1">Weighted across {result.totalCredits} credit hours.</p>}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="font-semibold">Official MKU links</h3>
          <a
            href="https://login.mku.ac.ke/"
            target="_blank"
            rel="noreferrer"
            className="flex min-h-11 items-center justify-between rounded-lg border border-border px-3 text-sm font-medium transition-colors hover:bg-secondary"
          >
            Student Portal login{" "}
            <ExternalLink className="size-4 text-muted-foreground" aria-hidden="true" />
          </a>
          <a
            href="https://portal.mku.ac.ke/"
            target="_blank"
            rel="noreferrer"
            className="flex min-h-11 items-center justify-between rounded-lg border border-border px-3 text-sm font-medium transition-colors hover:bg-secondary"
          >
            MKU Digital Services Hub{" "}
            <ExternalLink className="size-4 text-muted-foreground" aria-hidden="true" />
          </a>
        </section>
      </DialogContent>
    </Dialog>
  );
}
