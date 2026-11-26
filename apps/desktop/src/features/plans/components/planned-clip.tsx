import { Pencil, Play, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentPlayer } from "@/features/renders/components/segment-player";
import { formatDuration } from "@/features/videos/format";
import type { PlannedClip as Clip } from "../api";

interface PlannedClipProps {
  clip: Clip;
  thumbnailUrl: string | undefined;
  excerpt: string;
  /** The original video; Preview plays only this clip's range of it. */
  previewUrl: string;
  onRemove: () => void;
  /** Rejects with the API's reason when the new times are not allowed. */
  onAdjust: (startSeconds: number, endSeconds: number) => Promise<unknown>;
}

export function PlannedClip({ clip, thumbnailUrl, excerpt, previewUrl, onRemove, onAdjust }: PlannedClipProps) {
  const [editing, setEditing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const length = clip.endSeconds - clip.startSeconds;
  return (
    <li className="grid gap-2 py-4" aria-label={clip.title}>
      <div className="flex gap-4">
        {thumbnailUrl && <img src={thumbnailUrl} alt="" loading="lazy" className="h-20 w-auto shrink-0 rounded border" />}
        <div className="grid min-w-0 flex-1 gap-1 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{clip.title}</span>
            <Badge variant="secondary" className="tabular-nums">
              {formatDuration(clip.startSeconds)}–{formatDuration(clip.endSeconds)} · {length.toFixed(0)} s
            </Badge>
            <Badge variant="outline">score {clip.score}/10</Badge>
          </div>
          <p>
            <span className="text-muted-foreground">Hook: </span>
            {clip.hook}
          </p>
          <p>
            <span className="text-muted-foreground">Caption: </span>
            {clip.caption}
          </p>
          <p className="text-muted-foreground">Why: {clip.reason}</p>
          {excerpt && <p className="text-muted-foreground line-clamp-3 italic">“{excerpt}”</p>}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" size="icon" aria-label={`Preview ${clip.title}`} onClick={() => setPreviewing((p) => !p)}>
            <Play aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" aria-label={`Adjust ${clip.title}`} onClick={() => setEditing((e) => !e)}>
            <Pencil aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" aria-label={`Remove ${clip.title}`} onClick={onRemove}>
            <Trash2 aria-hidden />
          </Button>
        </div>
      </div>
      {previewing && (
        <SegmentPlayer src={previewUrl} start={clip.startSeconds} end={clip.endSeconds} label={`Preview of ${clip.title}`} />
      )}
      {editing && <AdjustForm clip={clip} onAdjust={onAdjust} onDone={() => setEditing(false)} />}
    </li>
  );
}

function AdjustForm({ clip, onAdjust, onDone }: Pick<PlannedClipProps, "clip" | "onAdjust"> & { onDone: () => void }) {
  const [start, setStart] = useState(clip.startSeconds);
  const [end, setEnd] = useState(clip.endSeconds);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      setError("Enter both a start and an end time");
      return;
    }
    try {
      await onAdjust(start, end);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 pl-1" noValidate>
      <div className="grid gap-1.5">
        <Label htmlFor={`start-${clip.id}`}>Start (s)</Label>
        <Input id={`start-${clip.id}`} type="number" step={0.5} className="w-28" value={start} onChange={(e) => setStart(e.target.valueAsNumber)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`end-${clip.id}`}>End (s)</Label>
        <Input id={`end-${clip.id}`} type="number" step={0.5} className="w-28" value={end} onChange={(e) => setEnd(e.target.valueAsNumber)} />
      </div>
      <Button type="submit" size="sm">
        Save
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onDone}>
        Cancel
      </Button>
      {error && (
        <p role="alert" className="text-destructive basis-full text-sm">
          {error}
        </p>
      )}
    </form>
  );
}
