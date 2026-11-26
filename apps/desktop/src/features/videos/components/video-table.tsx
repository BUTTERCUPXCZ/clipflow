import { Film } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Video } from "../api";
import { formatBytes, formatDuration, formatResolution } from "../format";
import { useDeleteVideo, useVideos } from "../queries";
import { DeleteVideoDialog } from "./delete-video-dialog";
import { VideoStatus } from "./video-status";

export function VideoTable({ projectId }: { projectId: string }) {
  const videos = useVideos(projectId);
  const remove = useDeleteVideo(projectId);

  if (videos.isPending) return <p className="text-muted-foreground text-sm">Loading videos…</p>;
  if (videos.isError) {
    return (
      <p role="alert" className="text-destructive text-sm">
        Could not load videos: {videos.error.message}
      </p>
    );
  }
  if (!videos.data.length) {
    return (
      <div className="text-muted-foreground flex flex-col items-center gap-2 rounded-xl border border-dashed py-10 text-center text-sm">
        <Film className="size-6" aria-hidden />
        <p>No videos yet. Import the long-form footage you want to turn into clips.</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead className="text-right">Size</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Duration</TableHead>
          <TableHead className="text-right">Resolution</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {videos.data.map((video) => (
          <VideoRow key={video.id} video={video} onDelete={() => remove.mutateAsync(video.id)} />
        ))}
      </TableBody>
    </Table>
  );
}

function VideoRow({ video, onDelete }: { video: Video; onDelete: () => Promise<unknown> }) {
  return (
    <TableRow>
      <TableCell className="max-w-72 truncate font-medium" title={video.filename}>
        {video.filename}
      </TableCell>
      <TableCell className="text-right tabular-nums">{formatBytes(video.fileSize)}</TableCell>
      <TableCell>
        <VideoStatus video={video} />
      </TableCell>
      <TableCell className="text-right tabular-nums">{formatDuration(video.duration)}</TableCell>
      <TableCell className="text-right tabular-nums">{formatResolution(video.width, video.height)}</TableCell>
      <TableCell className="text-right">
        <DeleteVideoDialog video={video} onConfirm={onDelete} />
      </TableCell>
    </TableRow>
  );
}
