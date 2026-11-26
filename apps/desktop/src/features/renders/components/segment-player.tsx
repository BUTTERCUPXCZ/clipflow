import { useEffect, useRef } from "react";

/** Plays only [start, end] of a video: the preview of a planned clip, straight from the original. */
export function SegmentPlayer({ src, start, end, label }: { src: string; start: number; end: number; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    // Adjusted times: move to the new start (once metadata is there; before that onLoadedMetadata does it).
    if (ref.current && ref.current.readyState > 0) ref.current.currentTime = start;
  }, [start]);
  return (
    <video
      ref={ref}
      src={src}
      controls
      preload="metadata"
      aria-label={label}
      className="aspect-video w-full max-w-xl rounded border bg-black"
      onLoadedMetadata={() => {
        if (ref.current) ref.current.currentTime = start;
      }}
      onTimeUpdate={() => {
        const video = ref.current;
        if (!video) return;
        if (video.currentTime >= end || video.currentTime < start - 0.5) {
          video.pause();
          video.currentTime = start; // the next Play starts the clip again
        }
      }}
    />
  );
}
