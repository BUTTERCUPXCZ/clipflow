import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

/**
 * Mirrors SUPPORTED_EXTENSIONS in apps/api/src/modules/videos/import/container-signatures.ts.
 * The picker filter is a convenience only; the API validates every file again.
 */
export const VIDEO_EXTENSIONS = [
  "mp4", "m4v", "mov", "3gp", "3g2", "mkv", "webm", "avi", "ts", "mts", "m2ts",
  "mpg", "mpeg", "vob", "wmv", "asf", "flv", "ogv", "mxf",
] as const;

/** The only place that touches the native dialog. Outside Tauri (plain browser dev) there is no picker. */
export async function pickVideoFiles(): Promise<string[]> {
  if (!isTauri()) return [];
  const picked = await open({
    title: "Import videos",
    multiple: true,
    directory: false,
    filters: [{ name: "Video files", extensions: [...VIDEO_EXTENSIONS] }],
  });
  return picked ?? [];
}
