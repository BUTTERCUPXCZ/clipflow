import { AudioLines, Images } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDuration } from "@/features/videos/format";
import type { Job } from "../api";
import { useJobFrames } from "../queries";
import { FrameStrip } from "./frame-strip";

/** What a completed job produced: the audio track and the sampled frames. */
export function ResultsCard({ job }: { job: Job }) {
  const artifacts = job.artifacts!;
  const frames = useJobFrames(job.id, true);
  const every = artifacts.frameIntervalSeconds === 1 ? "every second" : `every ${artifacts.frameIntervalSeconds} s`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Results</CardTitle>
        <CardDescription>Prepared for analysis in the next step.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <AudioLines className="text-muted-foreground size-4" aria-hidden />
            <dt className="sr-only">Audio</dt>
            <dd>
              {artifacts.hasAudio
                ? `Audio: ${formatDuration(artifacts.audioDurationSeconds)} (16 kHz mono)`
                : "No audio track"}
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <Images className="text-muted-foreground size-4" aria-hidden />
            <dt className="sr-only">Frames</dt>
            <dd>
              {artifacts.frameCount} frames, one {every}
            </dd>
          </div>
        </dl>
        {frames.isPending && <p className="text-muted-foreground text-sm">Loading frames…</p>}
        {frames.isError && (
          <p role="alert" className="text-destructive text-sm">
            Could not load frames: {frames.error.message}
          </p>
        )}
        {frames.data && <FrameStrip jobId={job.id} frames={frames.data} />}
      </CardContent>
    </Card>
  );
}
