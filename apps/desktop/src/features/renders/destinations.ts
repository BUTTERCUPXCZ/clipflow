import { isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

/** The only place that asks the user where exports go (the native dialogs). Null = cancelled or no Tauri. */
export async function pickSaveFile(title: string): Promise<string | null> {
  if (!isTauri()) return null;
  return save({
    title: "Save clip",
    defaultPath: `${title.replace(/[<>:"/\\|?*]/g, " ").trim() || "clip"}.mp4`,
    filters: [{ name: "MP4 video", extensions: ["mp4"] }],
  });
}

export async function pickExportFolder(): Promise<string | null> {
  if (!isTauri()) return null;
  const picked = await open({ title: "Export all clips to…", directory: true, multiple: false });
  return typeof picked === "string" ? picked : null;
}
