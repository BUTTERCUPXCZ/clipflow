import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes, formatDuration } from "@/features/videos/format";
import { type RenderedClip, rendersApi } from "../api";

/** One finished short: a vertical player, its facts, and Save…. */
export function RenderedClipCard({ clip, onSave, subtitle }: { clip: RenderedClip; onSave: () => void; subtitle?: string }) {
  return (
    <figure className="grid w-48 gap-2" aria-label={clip.title}>
      <video
        src={rendersApi.fileUrl(clip.id)}
        poster={rendersApi.thumbnailUrl(clip.id)}
        controls
        preload="none"
        className="aspect-[9/16] w-48 rounded border bg-black"
      />
      <figcaption className="grid gap-0.5 text-sm">
        <span className="line-clamp-2 font-medium">{clip.title}</span>
        {subtitle && <span className="text-muted-foreground truncate text-xs">{subtitle}</span>}
        <span className="text-muted-foreground text-xs tabular-nums">
          {formatDuration(clip.durationSeconds)} · {formatBytes(clip.sizeBytes)} · {clip.width}×{clip.height}
        </span>
      </figcaption>
      <Button variant="outline" size="sm" onClick={onSave}>
        <Download aria-hidden />
        Save…
      </Button>
    </figure>
  );
}
