import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useGallery } from "../queries";
import { useExport } from "../use-export";
import { RenderedClipCard } from "./rendered-clip-card";
import { ExportMessage } from "./renders-section";

/** Every rendered short across all projects, newest first. */
export function ClipsPage() {
  const gallery = useGallery();
  const exporter = useExport();
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Clips</h1>
        <p className="text-muted-foreground text-sm">Every rendered short, newest first. Play one, or save it anywhere.</p>
      </div>
      <ExportMessage state={exporter.state} />
      {gallery.isPending && <p className="text-muted-foreground text-sm">Loading clips…</p>}
      {gallery.isError && (
        <p role="alert" className="text-destructive text-sm">
          Could not load the clips: {gallery.error.message}
        </p>
      )}
      {gallery.data?.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No clips yet</CardTitle>
            <CardDescription>
              Open a video, process it, plan clips, then render them. Rendered clips appear here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/projects" className="text-sm underline">
              Go to projects
            </Link>
          </CardContent>
        </Card>
      )}
      <div className="flex flex-wrap gap-6">
        {gallery.data?.map((clip) => (
          <div key={clip.id} className="grid gap-1">
            <RenderedClipCard clip={clip} subtitle={clip.videoName} onSave={() => exporter.saveClip(clip)} />
            <Link
              to="/projects/$projectId/videos/$videoId"
              params={{ projectId: clip.projectId, videoId: clip.videoId }}
              className="text-muted-foreground text-xs underline"
            >
              Open video
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
