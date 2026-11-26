import { Trash2 } from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { Project } from "../api";

interface DeleteProjectDialogProps {
  project: Project;
  /** Resolves when the project is gone; a rejection keeps the dialog open with the error. */
  onConfirm: () => Promise<unknown>;
}

export function DeleteProjectDialog({ project, onConfirm }: DeleteProjectDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function confirm(event: React.MouseEvent) {
    event.preventDefault(); // keep the dialog open until the delete has finished
    setPending(true);
    setError(undefined);
    try {
      await onConfirm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the project");
      setPending(false);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" className="text-destructive hover:text-destructive">
          <Trash2 aria-hidden />
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{project.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the project and every video imported into it from ClipForge. Your original files are not
            touched. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={confirm} disabled={pending} className="bg-destructive hover:bg-destructive/90 text-white">
            {pending ? "Deleting…" : "Delete project"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
