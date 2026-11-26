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
import type { Video } from "../api";

interface DeleteVideoDialogProps {
  video: Video;
  onConfirm: () => Promise<unknown>;
}

export function DeleteVideoDialog({ video, onConfirm }: DeleteVideoDialogProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const importing = video.status === "IMPORTING";

  async function confirm(event: React.MouseEvent) {
    event.preventDefault(); // close only once the delete has succeeded
    setPending(true);
    setError(undefined);
    try {
      await onConfirm();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the video");
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Delete ${video.filename}`} title="Delete video">
          <Trash2 aria-hidden />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{importing ? "Cancel this import?" : `Delete “${video.filename}”?`}</AlertDialogTitle>
          <AlertDialogDescription>
            {importing
              ? "The copy stops now and the partly imported file is removed. Your original file is not touched."
              : "ClipForge's copy of this video is removed. Your original file is not touched."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Keep</AlertDialogCancel>
          <AlertDialogAction onClick={confirm} disabled={pending} className="bg-destructive hover:bg-destructive/90 text-white">
            {pending ? "Deleting…" : importing ? "Cancel import and delete" : "Delete video"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
