import { type FormEvent, type ReactNode, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import type { ProjectInput } from "../api";

export const NAME_MAX = 100;
export const DESCRIPTION_MAX = 1000;

/** Same rules as the API's projects.schemas.ts, checked before any request is sent. */
export function validateProject(input: { name: string; description: string }): Partial<Record<keyof ProjectInput, string>> {
  const errors: Partial<Record<keyof ProjectInput, string>> = {};
  const name = input.name.trim();
  if (!name) errors.name = "Name is required";
  else if (name.length > NAME_MAX) errors.name = `Name must be at most ${NAME_MAX} characters`;
  if (input.description.trim().length > DESCRIPTION_MAX) {
    errors.description = `Description must be at most ${DESCRIPTION_MAX} characters`;
  }
  return errors;
}

interface ProjectFormDialogProps {
  trigger: ReactNode;
  title: string;
  description: string;
  submitLabel: string;
  initial?: { name: string; description: string | null };
  /** Throw to keep the dialog open; the error message is shown in the form. */
  onSubmit: (input: ProjectInput) => Promise<unknown>;
}

/** Create and rename both use this dialog; it only collects and validates input. */
export function ProjectFormDialog({ trigger, title, description, submitLabel, initial, onSubmit }: ProjectFormDialogProps) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so every opening starts from `initial`. */}
        {open && (
          <ProjectForm initial={initial} submitLabel={submitLabel} onSubmit={onSubmit} onDone={() => setOpen(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface ProjectFormProps {
  initial?: { name: string; description: string | null };
  submitLabel: string;
  onSubmit: (input: ProjectInput) => Promise<unknown>;
  onDone: () => void;
}

function ProjectForm({ initial, submitLabel, onSubmit, onDone }: ProjectFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [errors, setErrors] = useState<ReturnType<typeof validateProject>>({});
  const [serverError, setServerError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = validateProject({ name, description });
    setErrors(found);
    if (Object.keys(found).length) return;

    setPending(true);
    setServerError(undefined);
    try {
      await onSubmit({ name: name.trim(), description: description.trim() || null });
      onDone();
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="project-name">Name</Label>
        <Input
          id="project-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? "project-name-error" : undefined}
          autoFocus
        />
        {errors.name && <FieldError id="project-name-error">{errors.name}</FieldError>}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="project-description">
          Description <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Textarea
          id="project-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-invalid={!!errors.description}
          aria-describedby={errors.description ? "project-description-error" : undefined}
          rows={3}
        />
        {errors.description && <FieldError id="project-description-error">{errors.description}</FieldError>}
      </div>
      {serverError && <FieldError>{serverError}</FieldError>}
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="text-destructive text-sm">
      {children}
    </p>
  );
}
