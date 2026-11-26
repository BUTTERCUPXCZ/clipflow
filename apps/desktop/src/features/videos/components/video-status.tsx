import { CircleCheck, CircleX, LoaderCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { Video } from "../api";
import { importPercent } from "../format";

/** Status cell: a badge, plus live progress while importing or the reason when it failed. */
export function VideoStatus({ video }: { video: Video }) {
  if (video.status === "IMPORTING") {
    const percent = importPercent(video.bytesCopied, video.fileSize);
    return (
      <div className="grid min-w-36 gap-1.5">
        <Badge variant="outline">
          <LoaderCircle className="animate-spin" aria-hidden />
          Importing {percent}%
        </Badge>
        <Progress value={percent} aria-label={`Importing ${video.filename}`} />
      </div>
    );
  }
  if (video.status === "FAILED") {
    return (
      <div className="grid gap-1">
        <Badge variant="destructive">
          <CircleX aria-hidden />
          Failed
        </Badge>
        {video.errorMessage && <p className="text-destructive max-w-64 text-xs">{video.errorMessage}</p>}
      </div>
    );
  }
  return (
    <Badge variant="secondary">
      <CircleCheck className="text-emerald-600" aria-hidden />
      Ready
    </Badge>
  );
}
