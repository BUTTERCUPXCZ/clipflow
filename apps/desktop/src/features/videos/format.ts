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
