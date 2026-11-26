import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { formatDuration } from "@/features/videos/format";
import { type FrameInfo, jobsApi } from "../api";

export const STRIP_SIZE = 24;

/** Up to `count` frames spread evenly over the whole list, always including the first and the last. */
export function sampleEvenly<T>(items: readonly T[], count: number): T[] {
  if (items.length <= count) return [...items];
  if (count === 1) return [items[0]];
  const step = (items.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => items[Math.round(i * step)]);
}

/** A horizontal strip of evenly spaced thumbnails; clicking one shows it large. */
export function FrameStrip({ jobId, frames }: { jobId: string; frames: FrameInfo[] }) {
  const [open, setOpen] = useState<FrameInfo>();
  const shown = sampleEvenly(frames, STRIP_SIZE);

  return (
    <>
      <ul className="flex gap-2 overflow-x-auto pb-2" aria-label="Extracted frames">
        {shown.map((frame) => (
          <li key={frame.index} className="shrink-0">
            <button
              type="button"
              onClick={() => setOpen(frame)}
              className="focus-visible:ring-ring/50 group grid gap-1 rounded-md outline-none focus-visible:ring-[3px]"
              aria-label={`Frame at ${formatDuration(frame.timestampSeconds)}`}
            >
              <img
                src={jobsApi.frameUrl(jobId, frame.index)}
                alt=""
                loading="lazy"
                className="h-20 w-auto rounded-md border object-cover transition-transform group-hover:scale-[1.03]"
              />
              <span className="text-muted-foreground text-xs tabular-nums">{formatDuration(frame.timestampSeconds)}</span>
            </button>
          </li>
        ))}
      </ul>
      <Dialog open={open !== undefined} onOpenChange={(isOpen) => !isOpen && setOpen(undefined)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogTitle>Frame at {open ? formatDuration(open.timestampSeconds) : ""}</DialogTitle>
          <DialogDescription className="sr-only">Full-size extracted frame</DialogDescription>
          {open && <img src={jobsApi.frameUrl(jobId, open.index)} alt="" className="w-full rounded-md" />}
        </DialogContent>
      </Dialog>
    </>
  );
}
