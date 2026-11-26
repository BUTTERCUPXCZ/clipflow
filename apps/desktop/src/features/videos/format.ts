const PLACEHOLDER = "—";

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** h:mm:ss, or m:ss under an hour. "—" until FFprobe has read the duration (Phase 3). */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return PLACEHOLDER;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function formatResolution(width: number | null, height: number | null): string {
  return width && height ? `${width}×${height}` : PLACEHOLDER;
}

export function importPercent(bytesCopied: number, fileSize: number): number {
  return fileSize > 0 ? Math.min(100, Math.floor((bytesCopied / fileSize) * 100)) : 0;
}

const CODEC_NAMES: Record<string, string> = {
  h264: "H.264",
  hevc: "H.265",
  av1: "AV1",
  vp9: "VP9",
  vp8: "VP8",
  mpeg4: "MPEG-4",
  mpeg2video: "MPEG-2",
  prores: "ProRes",
  aac: "AAC",
  mp3: "MP3",
  opus: "Opus",
  vorbis: "Vorbis",
  ac3: "AC-3",
  flac: "FLAC",
};

const codecName = (codec: string) => CODEC_NAMES[codec] ?? codec.toUpperCase();

/** "H.264 / AAC", "H.264 / no audio", or "—" before FFprobe has run. */
export function formatCodecs(video: { videoCodec: string | null; audioCodec: string | null; hasAudio: boolean | null }): string {
  if (!video.videoCodec) return PLACEHOLDER;
  const audio = video.hasAudio && video.audioCodec ? codecName(video.audioCodec) : "no audio";
  return `${codecName(video.videoCodec)} / ${audio}`;
}

export function formatFrameRate(fps: number | null): string {
  return fps ? `${Number.isInteger(fps) ? fps : fps.toFixed(2)} fps` : PLACEHOLDER;
}
