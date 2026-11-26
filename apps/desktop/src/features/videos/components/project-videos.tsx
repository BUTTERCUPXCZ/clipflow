import { ImportButton } from "./import-button";
import { VideoTable } from "./video-table";

/** The videos section of a project page. */
export function ProjectVideos({ projectId }: { projectId: string }) {
  return (
    <section aria-labelledby="videos-heading">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 id="videos-heading" className="text-lg font-semibold">
            Videos
          </h2>
          <p className="text-muted-foreground text-sm">
            ClipForge copies each file into its media folder. Your originals stay where they are.
          </p>
        </div>
        <ImportButton projectId={projectId} />
      </header>
      <VideoTable projectId={projectId} />
    </section>
  );
}
