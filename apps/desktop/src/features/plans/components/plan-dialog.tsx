import { Scissors } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PlanSettings } from "../api";

/** Same limits as the API's plans.schemas.ts, checked before any request is sent. */
export function validateSettings(s: PlanSettings): string | undefined {
  if (![s.minSeconds, s.maxSeconds, s.maxClips].every(Number.isInteger)) return "Use whole numbers";
  if (s.minSeconds < 5 || s.maxSeconds > 180) return "Clip length must be between 5 and 180 seconds";
  if (s.minSeconds > s.maxSeconds) return "The shortest clip can't be longer than the longest";
  if (s.maxClips < 1 || s.maxClips > 20) return "Plan between 1 and 20 clips";
  return undefined;
}

interface PlanDialogProps {
  defaults: PlanSettings;
  disabled: boolean;
  /** Throw to keep the dialog open; the message is shown in the form. */
  onSubmit: (settings: PlanSettings) => Promise<unknown>;
}

export function PlanDialog({ defaults, disabled, onSubmit }: PlanDialogProps) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={disabled}>
          <Scissors aria-hidden />
          Plan clips
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Plan clips</DialogTitle>
          <DialogDescription>
            The local model reads the transcript and the visual timeline and proposes short clips. Nothing is cut yet.
          </DialogDescription>
        </DialogHeader>
        {open && <SettingsForm defaults={defaults} onSubmit={onSubmit} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function SettingsForm({ defaults, onSubmit, onDone }: Omit<PlanDialogProps, "disabled"> & { onDone: () => void }) {
  const [values, setValues] = useState(defaults);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const field = (key: keyof PlanSettings, label: string) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`plan-${key}`}>{label}</Label>
      <Input
        id={`plan-${key}`}
        type="number"
        value={Number.isNaN(values[key]) ? "" : values[key]}
        onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.valueAsNumber }))}
      />
    </div>
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problem = validateSettings(values);
    setError(problem);
    if (problem) return;
    setPending(true);
    try {
      await onSubmit(values);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <div className="grid grid-cols-3 gap-3">
        {field("minSeconds", "Shortest (s)")}
        {field("maxSeconds", "Longest (s)")}
        {field("maxClips", "Max clips")}
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending ? "Starting…" : "Plan clips"}
        </Button>
      </DialogFooter>
    </form>
  );
}
