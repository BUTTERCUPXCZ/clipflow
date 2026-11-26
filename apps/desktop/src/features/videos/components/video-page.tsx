import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { JobStatusLine, ProcessingCard } from "@/features/jobs/components/processing-card";
import { ResultsCard } from "@/features/jobs/components/results-card";
import { useVideoJobs } from "@/features/jobs/queries";
import { isNotFound } from "@/features/projects/queries";
import type { Video } from "../api";
import { formatBytes, formatCodecs, formatDuration, formatFrameRate, formatResolution } from "../format";
import { useVideo } from "../queries";

/** One video: what FFprobe found, its processing, the results, and earlier runs. */
export function VideoPage({ projectId, videoId }: { projectId: string; videoId: string }) {
  const video = useVideo(videoId);
  const jobs = useVideoJobs(videoId);

  const back = (
    <Link
      to="/projects/$projectId"
      params={{ projectId }}
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
    >
      <ArrowLeft className="size-4" aria-hidden />
      Back to project
    </Link>
  );

  if (video.isPending) return <p className="text-muted-foreground text-sm">Loading video…</p>;
  if (video.isError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="font-medium">
          {isNotFound(video.error) ? "Video not found" : `Could not load the video: ${video.error.message}`}
        </p>
        {back}
      </div>
    );
  }

  const latest = jobs.data?.[0];
  const completed = jobs.data?.find((j) => j.status === "COMPLETED" && j.artifacts);
  return (
    <section aria-labelledby="video-heading" className="grid max-w-5xl gap-6">
      <div>
        {back}
        <h1 id="video-heading" className="mt-3 truncate text-2xl font-semibold tracking-tight" title={video.data.filename}>
          {video.data.filename}
        </h1>
      </div>
      <MetadataCard video={video.data} />
      <ProcessingCard video={video.data} latest={latest} />
      {completed && <ResultsCard job={completed} />}
      {jobs.data && jobs.data.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {jobs.data.slice(1).map((job) => (
                <li key={job.id} className="flex items-start justify-between gap-4 py-3">
                  <span className="text-muted-foreground text-sm">{new Date(job.createdAt).toLocaleString()}</span>
                  <JobStatusLine job={job} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function MetadataCard({ video }: { video: Video }) {
  const facts: [string, string][] = [
    ["Duration", formatDuration(video.duration)],
    ["Resolution", formatResolution(video.width, video.height)],
    ["Frame rate", formatFrameRate(video.frameRate)],
    ["Codecs", formatCodecs(video)],
    ["Size", formatBytes(video.fileSize)],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Video</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-5">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
