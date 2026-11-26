import type { Scene } from "@/features/analysis/api";
import { frameIndexAt } from "@/features/analysis/api";
import { jobsApi } from "@/features/jobs/api";
import { formatDuration } from "@/features/videos/format";
import { type Experiment, secondsPerFrame } from "../api";

const label = (e: Experiment) => `${e.modelName} · ${e.settings.batchSize}/request`;

/** Every timestamp either run analysed, in time order, with what each one saw. */
export function alignScenes(a: Experiment, b: Experiment): { timestampSeconds: number; a?: Scene; b?: Scene }[] {
  const byTime = new Map<number, { a?: Scene; b?: Scene }>();
  for (const scene of a.output?.scenes ?? []) byTime.set(scene.timestampSeconds, { ...byTime.get(scene.timestampSeconds), a: scene });
  for (const scene of b.output?.scenes ?? []) byTime.set(scene.timestampSeconds, { ...byTime.get(scene.timestampSeconds), b: scene });
  return [...byTime.entries()].sort(([x], [y]) => x - y).map(([timestampSeconds, pair]) => ({ timestampSeconds, ...pair }));
}

export function CompareView({ a, b }: { a: Experiment; b: Experiment }) {
  const rows = alignScenes(a, b);
  const metrics: [string, (e: Experiment) => string][] = [
    ["Seconds per frame", (e) => (e.metrics ? secondsPerFrame(e.metrics).toFixed(1) : "—")],
    ["Total time", (e) => (e.metrics ? formatDuration(e.metrics.totalMs / 1000) : "—")],
    ["Model load", (e) => (e.metrics ? `${(e.metrics.loadMs / 1000).toFixed(1)} s` : "—")],
    ["Peak VRAM", (e) => (e.metrics?.peakVramMiB != null ? `${e.metrics.peakVramMiB} MiB` : "unknown")],
    ["Valid batches", (e) => (e.metrics ? `${e.metrics.validBatches} of ${e.metrics.totalBatches}` : "—")],
  ];

  return (
    <section aria-label="Comparison" className="grid gap-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground text-left">
            <th className="py-1 font-normal">Metric</th>
            <th className="py-1 font-medium">{label(a)}</th>
            <th className="py-1 font-medium">{label(b)}</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map(([name, value]) => (
            <tr key={name} className="border-t">
              <td className="text-muted-foreground py-1.5">{name}</td>
              <td className="py-1.5 tabular-nums">{value(a)}</td>
              <td className="py-1.5 tabular-nums">{value(b)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ol className="divide-y">
        {rows.map((row) => {
          const index = a.output ? frameIndexAt(a.output, row.timestampSeconds) : undefined;
          return (
            <li key={row.timestampSeconds} className="grid grid-cols-[6rem_1fr_1fr] gap-3 py-3 text-sm">
              <div className="grid gap-1">
                {index !== undefined && (
                  <img src={jobsApi.frameUrl(a.processingJobId, index)} alt="" loading="lazy" className="w-24 rounded border" />
                )}
                <span className="text-muted-foreground tabular-nums">{formatDuration(row.timestampSeconds)}</span>
              </div>
              <SceneCell scene={row.a} />
              <SceneCell scene={row.b} />
            </li>
          );
        })}
      </ol>
      <InvalidBatches experiments={[a, b]} />
    </section>
  );
}

function SceneCell({ scene }: { scene: Scene | undefined }) {
  if (!scene) return <p className="text-muted-foreground italic">No valid answer for this frame</p>;
  return (
    <div className="grid gap-1">
      <p>{scene.description}</p>
      <p className="text-muted-foreground text-xs">
        {scene.cameraFraming} · {scene.verticalCropSuitable ? "crop OK" : "hard to crop"}
        {scene.subjects.length ? ` · ${scene.subjects.join(", ")}` : ""}
      </p>
    </div>
  );
}

function InvalidBatches({ experiments }: { experiments: Experiment[] }) {
  const invalid = experiments.flatMap((e) =>
    (e.output?.batches ?? []).filter((batch) => !batch.valid).map((batch) => ({ model: label(e), batch })),
  );
  if (!invalid.length) return null;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer">Invalid model answers ({invalid.length})</summary>
      <ul className="mt-2 grid gap-2">
        {invalid.map(({ model, batch }) => (
          <li key={`${model}-${batch.frameIndexes.join(",")}`} className="bg-muted rounded p-2">
            <p className="font-medium">
              {model}: frames {batch.frameIndexes.join(", ")}
            </p>
            <p className="text-destructive">{batch.errors.join(" · ")}</p>
            {batch.raw && <pre className="mt-1 max-h-32 overflow-auto text-xs whitespace-pre-wrap">{batch.raw}</pre>}
          </li>
        ))}
      </ul>
    </details>
  );
}
