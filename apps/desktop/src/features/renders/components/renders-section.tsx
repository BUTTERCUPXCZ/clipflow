import { Clapperboard, FolderDown, Square } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { isRenderRunning, type Render } from "../api";
import { useCancelRender, useCreateRender, useRender, useRenders } from "../queries";
import { type ExportState, useExport } from "../use-export";
import { RenderedClipCard } from "./rendered-clip-card";

/** Render a completed plan's kept clips, follow the render, then play and export the results. */
export function RendersSection({ planId, keptClips }: { planId: string; keptClips: number }) {
  const renders = useRenders(planId);
  const create = useCreateRender(planId);
  const [subtitles, setSubtitles] = useState(true);
  const [error, setError] = useState<string>();
  const latest = renders.data?.[0];
  const lastGood = renders.data?.find((r) => r.status === "COMPLETED");
  const running = latest !== undefined && isRenderRunning(latest);

  async function start() {
    setError(undefined);
    try {
      await create.mutateAsync(subtitles);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section aria-label="Rendering" className="grid gap-3 border-t pt-4">
      <div className="flex flex-wrap items-center gap-4">
        <Button onClick={start} disabled={running || create.isPending || keptClips === 0}>
          <Clapperboard aria-hidden />
          {latest?.status === "COMPLETED" ? "Render again" : "Render clips"}
        </Button>
        <Label className="flex items-center gap-2 font-normal">
          <input type="checkbox" checked={subtitles} onChange={(e) => setSubtitles(e.target.checked)} />
          Burn subtitles
        </Label>
        <span className="text-muted-foreground text-sm">9:16 · 1080×1920 · blurred background</span>
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      {latest && <LatestRender render={latest} />}
      {/* A failed or cancelled re-render must not hide the clips that were already rendered. */}
      {latest && latest.status !== "COMPLETED" && lastGood && <RenderedClips renderId={lastGood.id} />}
    </section>
  );
}

function LatestRender({ render }: { render: Render }) {
  const cancel = useCancelRender();
  if (isRenderRunning(render)) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <span>
          Rendering {render.clipCount} clip{render.clipCount === 1 ? "" : "s"}…
        </span>
        <Progress value={render.progress} aria-label="Rendering progress" className="max-w-sm" />
        <span className="tabular-nums">{render.progress}%</span>
        <Button variant="outline" size="sm" onClick={() => cancel.mutate(render.id)}>
          <Square aria-hidden />
          Cancel
        </Button>
      </div>
    );
  }
  if (render.status !== "COMPLETED") {
    return (
      <p role="status" className="text-sm">
        <Badge variant={render.status === "FAILED" ? "destructive" : "outline"}>{render.status === "FAILED" ? "Render failed" : "Render cancelled"}</Badge>{" "}
        {render.errorMessage}
      </p>
    );
  }
  return <RenderedClips renderId={render.id} />;
}

function RenderedClips({ renderId }: { renderId: string }) {
  const render = useRender(renderId);
  const exporter = useExport();
  if (render.isError) return <p className="text-destructive text-sm">Could not load the rendered clips: {render.error.message}</p>;
  if (!render.data) return <p className="text-muted-foreground text-sm">Loading rendered clips…</p>;
  const { clips, metrics, failures } = render.data;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted-foreground">
          {clips.length} rendered{metrics && ` in ${(metrics.elapsedMs / 1000).toFixed(0)} s with ${metrics.encoder}`}
        </span>
        <Button variant="outline" size="sm" onClick={() => exporter.exportAll(renderId)} disabled={exporter.state.kind === "busy"}>
          <FolderDown aria-hidden />
          Export all…
        </Button>
      </div>
      <ExportMessage state={exporter.state} />
      {!!failures?.length && (
        <ul className="text-destructive grid gap-1 text-sm" aria-label="Clips that failed to render">
          {failures.map((f) => (
            <li key={f.clipId}>A clip could not be rendered: {f.error}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-4">
        {clips.map((clip) => (
          <RenderedClipCard key={clip.id} clip={clip} onSave={() => exporter.saveClip(clip)} />
        ))}
      </div>
    </div>
  );
}

export function ExportMessage({ state }: { state: ExportState }) {
  if (state.kind === "busy") return <p className="text-muted-foreground text-sm">Exporting…</p>;
  if (state.kind === "done") return <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{state.message}</p>;
  if (state.kind === "error") return <p role="alert" className="text-destructive text-sm">{state.message}</p>;
  return null;
}
