import { FlaskConical, Square } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { formatBytes } from "@/features/videos/format";
import { type Experiment, isRunning, secondsPerFrame } from "../api";
import { useCancelExperiment, useExperiments, useRunExperiment, useVisionModels } from "../queries";
import { CompareView } from "./compare-view";

/** Run visual analysis with any installed vision model on this video's frames, and compare runs. */
export function ExperimentsPanel({ videoId, canRun }: { videoId: string; canRun: boolean }) {
  const models = useVisionModels();
  const experiments = useExperiments(videoId);
  const run = useRunExperiment(videoId);
  const cancel = useCancelExperiment();
  const [model, setModel] = useState<string>();
  const [batchSize, setBatchSize] = useState(2);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string>();

  const chosen = model ?? models.data?.find((m) => m.isDefault)?.name ?? models.data?.[0]?.name;
  const toggle = (id: string) =>
    setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id].slice(-2)));
  const compared = (experiments.data ?? []).filter((e) => selected.includes(e.id) && e.status === "COMPLETED");

  async function start() {
    if (!chosen) return;
    setError(undefined);
    try {
      await run.mutateAsync({ model: chosen, batchSize });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Model experiments</CardTitle>
        <CardDescription>Same frames, different model or settings: compare speed, memory and what each one sees.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="experiment-model">Vision model</Label>
            <select
              id="experiment-model"
              className="border-input bg-background h-9 rounded-md border px-2 text-sm"
              value={chosen ?? ""}
              onChange={(e) => setModel(e.target.value)}
              disabled={!models.data?.length}
            >
              {models.data?.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name} ({formatBytes(m.sizeBytes)}){m.isDefault ? " · default" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="experiment-batch">Frames per request</Label>
            <select
              id="experiment-batch"
              className="border-input bg-background h-9 rounded-md border px-2 text-sm"
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
            >
              {[1, 2, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <Button onClick={start} disabled={!canRun || !chosen || run.isPending}>
            <FlaskConical aria-hidden />
            Run experiment
          </Button>
        </div>
        {!canRun && <p className="text-muted-foreground text-sm">Process the video first: experiments use its extracted frames.</p>}
        {models.isError && <p className="text-destructive text-sm">Models unavailable: {models.error.message}</p>}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        {!!experiments.data?.length && (
          <ul className="divide-y" aria-label="Experiments">
            {experiments.data.map((e) => (
              <ExperimentRow
                key={e.id}
                experiment={e}
                selected={selected.includes(e.id)}
                onToggle={() => toggle(e.id)}
                onCancel={() => cancel.mutate(e.id)}
              />
            ))}
          </ul>
        )}
        {compared.length === 2 && <CompareView a={compared[0]} b={compared[1]} />}
        {selected.length > 0 && compared.length < 2 && (
          <p className="text-muted-foreground text-sm">Select two completed experiments to compare them.</p>
        )}
      </CardContent>
    </Card>
  );
}

function ExperimentRow({
  experiment: e,
  selected,
  onToggle,
  onCancel,
}: {
  experiment: Experiment;
  selected: boolean;
  onToggle: () => void;
  onCancel: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 text-sm">
      <input
        type="checkbox"
        aria-label={`Compare ${e.modelName} run`}
        checked={selected}
        onChange={onToggle}
        disabled={e.status !== "COMPLETED"}
      />
      <span className="font-medium">{e.modelName}</span>
      <span className="text-muted-foreground">
        {e.settings.batchSize}/request · ≤{e.settings.maxFrames} frames
      </span>
      {isRunning(e) ? (
        <span className="flex min-w-40 items-center gap-2">
          <Progress value={e.progress} aria-label={`Experiment ${e.modelName}`} className="w-28" />
          <span className="tabular-nums">{e.progress}%</span>
          <Button variant="ghost" size="icon" aria-label="Cancel experiment" onClick={onCancel}>
            <Square aria-hidden />
          </Button>
        </span>
      ) : e.status === "COMPLETED" && e.metrics ? (
        <span className="text-muted-foreground tabular-nums">
          {secondsPerFrame(e.metrics).toFixed(1)} s/frame · {e.metrics.peakVramMiB ?? "?"} MiB VRAM · {e.metrics.validBatches}/
          {e.metrics.totalBatches} valid
        </span>
      ) : (
        <Badge variant={e.status === "FAILED" ? "destructive" : "outline"} title={e.errorMessage ?? undefined}>
          {e.status === "FAILED" ? `Failed: ${e.errorMessage ?? ""}` : "Cancelled"}
        </Badge>
      )}
    </li>
  );
}
