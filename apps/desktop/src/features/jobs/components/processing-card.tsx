import { CircleCheck, CircleX, LoaderCircle, Play, Square, WifiOff } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { liveEvents } from "@/lib/live-events";
import type { Video } from "@/features/videos/api";
import { isActive, type Job } from "../api";
import { useCancelJob, useConnectionState, useProcessVideo, useWorkerMissing } from "../queries";

const STAGE_LABEL: Record<Job["status"], string> = {
  PENDING: "Waiting in the queue",
  VALIDATING: "Checking the video",
  EXTRACTING_MEDIA: "Extracting audio and frames",
  TRANSCRIBING: "Transcribing speech",
  ANALYZING_VISUALS: "Analysing frames",
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

/** Start, follow (live) and cancel processing of one video. */
export function ProcessingCard({ video, latest }: { video: Video; latest: Job | undefined }) {
  const process = useProcessVideo(video.id);
  const cancel = useCancelJob();
  const connection = useConnectionState(liveEvents);
  const [error, setError] = useState<string>();
  const running = latest !== undefined && isActive(latest);

  const run = (action: () => Promise<unknown>) => {
    setError(undefined);
    action().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Processing</CardTitle>
        <CardDescription>
          Extracts audio and frames, transcribes the speech, then describes what is seen with the local vision model.
        </CardDescription>
        <CardAction>
          {running ? (
            <Button variant="outline" onClick={() => run(() => cancel.mutateAsync(latest.id))} disabled={cancel.isPending}>
              <Square aria-hidden />
              Cancel
            </Button>
          ) : (
            <Button onClick={() => run(() => process.mutateAsync())} disabled={video.status !== "READY" || process.isPending}>
              <Play aria-hidden />
              {latest ? "Process again" : "Process"}
            </Button>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-3">
        {!latest && <p className="text-muted-foreground text-sm">Not processed yet.</p>}
        {latest && <JobStatusLine job={latest} />}
        {latest && <NoWorkerHint job={latest} />}
        {running && connection !== "open" && (
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <WifiOff className="size-3.5" aria-hidden />
            Live updates paused, reconnecting…
          </p>
        )}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Asks the health check, not a timer: a job can wait a long time behind an experiment on the one queue. */
export function NoWorkerHint({ job }: { job: Job }) {
  if (!useWorkerMissing(job.status === "PENDING")) return null;
  return (
    <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
      Still waiting. No processing worker seems to be running: start it with <code>npm run dev:ai</code>.
    </p>
  );
}

export function JobStatusLine({ job }: { job: Job }) {
  if (isActive(job)) {
    return (
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-1.5">
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            {STAGE_LABEL[job.status]}
          </span>
          <span className="tabular-nums">{job.progress}%</span>
        </div>
        <Progress value={job.progress} aria-label={`Processing: ${STAGE_LABEL[job.status]}`} />
      </div>
    );
  }
  if (job.status === "COMPLETED") {
    return (
      <Badge variant="secondary" className="w-fit">
        <CircleCheck className="text-emerald-600" aria-hidden />
        Completed
      </Badge>
    );
  }
  return (
    <div className="grid gap-1">
      <Badge variant={job.status === "FAILED" ? "destructive" : "outline"} className="w-fit">
        <CircleX aria-hidden />
        {STAGE_LABEL[job.status]}
      </Badge>
      {job.errorMessage && <p className="text-muted-foreground text-sm">{job.errorMessage}</p>}
    </div>
  );
}
