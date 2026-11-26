import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { jobsApi } from "@/features/jobs/api";
import { formatDuration } from "@/features/videos/format";
import { frameIndexAt, type Transcript, type VisualAnalysis } from "../api";
import { useAnalysis } from "../queries";

/** What the latest completed job understood: the transcript and the visual timeline. */
export function AnalysisCard({ videoId }: { videoId: string }) {
  const analysis = useAnalysis(videoId);
  if (!analysis.data) return null;
  const { transcript, visualAnalysis, processingJobId } = analysis.data;
  const { validBatches, totalBatches } = visualAnalysis.metrics;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Analysis</CardTitle>
        <CardDescription>
          {visualAnalysis.model} · {visualAnalysis.metrics.framesAnalysed} frames analysed
        </CardDescription>
        <CardAction>
          <Badge variant={validBatches === totalBatches ? "secondary" : "outline"}>
            {validBatches} of {totalBatches} batches valid
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="visual">
          <TabsList>
            <TabsTrigger value="visual">Visual timeline</TabsTrigger>
            <TabsTrigger value="transcript">Transcript</TabsTrigger>
          </TabsList>
          <TabsContent value="visual">
            <VisualTimeline visual={visualAnalysis} jobId={processingJobId} />
          </TabsContent>
          <TabsContent value="transcript">
            <TranscriptView transcript={transcript} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

export function VisualTimeline({ visual, jobId }: { visual: VisualAnalysis; jobId: string }) {
  if (!visual.scenes.length) return <p className="text-muted-foreground text-sm">No valid scene descriptions.</p>;
  return (
    <ol className="divide-y">
      {visual.scenes.map((scene) => {
        const index = frameIndexAt(visual, scene.timestampSeconds);
        return (
          <li key={scene.timestampSeconds} className="flex gap-4 py-3">
            {index !== undefined && (
              <img src={jobsApi.frameUrl(jobId, index)} alt="" loading="lazy" className="h-16 w-auto shrink-0 rounded border" />
            )}
            <div className="grid min-w-0 gap-1 text-sm">
              <p>
                <span className="text-muted-foreground mr-2 tabular-nums">{formatDuration(scene.timestampSeconds)}</span>
                {scene.description}
              </p>
              <div className="flex flex-wrap gap-1">
                {scene.subjects.map((s) => (
                  <Badge key={s} variant="outline">
                    {s}
                  </Badge>
                ))}
                <Badge variant="secondary">{scene.cameraFraming}</Badge>
                <Badge variant={scene.verticalCropSuitable ? "secondary" : "outline"}>
                  {scene.verticalCropSuitable ? "Vertical crop OK" : "Hard to crop vertically"}
                </Badge>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function TranscriptView({ transcript }: { transcript: Transcript | null }) {
  if (!transcript) return <p className="text-muted-foreground text-sm">This video has no audio track.</p>;
  if (!transcript.segments.length) return <p className="text-muted-foreground text-sm">No speech was detected.</p>;
  return (
    <ol className="grid max-h-96 gap-2 overflow-y-auto text-sm" aria-label={`Transcript (${transcript.language})`}>
      {transcript.segments.map((segment) => (
        <li key={segment.start} className="flex gap-3">
          <span className="text-muted-foreground shrink-0 tabular-nums">{formatDuration(segment.start)}</span>
          <span>{segment.text}</span>
        </li>
      ))}
    </ol>
  );
}
