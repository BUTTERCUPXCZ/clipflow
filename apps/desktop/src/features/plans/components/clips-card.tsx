import { Square } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { type Job, jobsApi } from "@/features/jobs/api";
import { rendersApi } from "@/features/renders/api";
import { RendersSection } from "@/features/renders/components/renders-section";
import { defaultSettings, isPlanRunning, type Plan, type PlanDetail } from "../api";
import { useAdjustClip, useCancelPlan, useCreatePlan, usePlan, usePlans, useRemoveClip } from "../queries";
import { PlanDialog } from "./plan-dialog";
import { PlannedClip } from "./planned-clip";

/** The extracted frame shown at a clip's start. */
export function frameIndexAt(job: Job | undefined, seconds: number): number | undefined {
  const a = job?.artifacts;
  if (!a?.frameCount) return undefined;
  return Math.min(a.frameCount - 1, Math.max(0, Math.round(seconds / a.frameIntervalSeconds)));
}

/** Plan clips on a processed video, then review the proposal: remove clips or adjust their times. */
export function ClipsCard({ videoId, durationSeconds, jobs }: { videoId: string; durationSeconds: number; jobs: Job[] }) {
  const plans = usePlans(videoId);
  const create = useCreatePlan(videoId);
  const latest = plans.data?.[0];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Clips</CardTitle>
        <CardDescription>Proposed short clips from what is said and shown. Review them before rendering.</CardDescription>
        <CardAction>
          <PlanDialog
            defaults={defaultSettings(durationSeconds)}
            disabled={latest !== undefined && isPlanRunning(latest)}
            onSubmit={(settings) => create.mutateAsync(settings)}
          />
        </CardAction>
      </CardHeader>
      <CardContent>
        {latest ? <LatestPlan plan={latest} jobs={jobs} /> : <p className="text-muted-foreground text-sm">No clips planned yet.</p>}
      </CardContent>
    </Card>
  );
}

function LatestPlan({ plan, jobs }: { plan: Plan; jobs: Job[] }) {
  const cancel = useCancelPlan();
  if (isPlanRunning(plan)) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <span>Planning clips…</span>
        <Progress value={plan.progress} aria-label="Planning progress" className="max-w-sm" />
        <span className="tabular-nums">{plan.progress}%</span>
        <Button variant="outline" size="sm" onClick={() => cancel.mutate(plan.id)}>
          <Square aria-hidden />
          Cancel
        </Button>
      </div>
    );
  }
  if (plan.status !== "COMPLETED") {
    return (
      <p role="status" className="text-sm">
        <Badge variant={plan.status === "FAILED" ? "destructive" : "outline"}>{plan.status === "FAILED" ? "Failed" : "Cancelled"}</Badge>{" "}
        {plan.errorMessage}
      </p>
    );
  }
  return <CompletedPlan planId={plan.id} videoId={plan.sourceVideoId} job={jobs.find((j) => j.id === plan.processingJobId)} />;
}

function CompletedPlan({ planId, videoId, job }: { planId: string; videoId: string; job: Job | undefined }) {
  const plan = usePlan(planId);
  const adjust = useAdjustClip(planId);
  const remove = useRemoveClip(planId);
  if (!plan.data) return null;
  const kept = plan.data.clips.filter((c) => !c.removedAt);
  return (
    <div className="grid gap-2">
      <PlanSummary plan={plan.data} kept={kept.length} />
      <ol className="divide-y">
        {kept.map((clip) => {
          const index = frameIndexAt(job, clip.startSeconds);
          return (
            <PlannedClip
              key={clip.id}
              clip={clip}
              thumbnailUrl={job && index !== undefined ? jobsApi.frameUrl(job.id, index) : undefined}
              excerpt={clip.excerpt}
              previewUrl={rendersApi.sourceUrl(videoId)}
              onRemove={() => remove.mutate(clip.id)}
              onAdjust={(startSeconds, endSeconds) => adjust.mutateAsync({ clipId: clip.id, startSeconds, endSeconds })}
            />
          );
        })}
      </ol>
      <RendersSection planId={planId} keptClips={kept.length} />
    </div>
  );
}

function PlanSummary({ plan, kept }: { plan: PlanDetail; kept: number }) {
  const [open, setOpen] = useState(false);
  const skipped = plan.skipped ?? [];
  return (
    <div className="text-muted-foreground grid gap-1 text-sm">
      <p>
        {kept} clip{kept === 1 ? "" : "s"} · {plan.modelName}
        {plan.metrics && ` · planned in ${(plan.metrics.elapsedMs / 1000).toFixed(0)} s with ${plan.metrics.llmCalls} model calls`}
      </p>
      {skipped.length > 0 && (
        <button type="button" className="text-left underline" onClick={() => setOpen((o) => !o)}>
          {skipped.length} part{skipped.length === 1 ? "" : "s"} of the video could not be analysed
        </button>
      )}
      {open && (
        <ul className="grid gap-1">
          {skipped.map((s) => (
            <li key={`${s.start}-${s.end}`}>
              {s.start.toFixed(0)}–{s.end.toFixed(0)} s: {s.errors.join(" · ")}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
