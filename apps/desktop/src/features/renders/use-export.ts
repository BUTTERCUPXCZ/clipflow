import { isTauri } from "@tauri-apps/api/core";
import { useState } from "react";
import { rendersApi } from "./api";
import { pickExportFolder, pickSaveFile } from "./destinations";

export type ExportState = { kind: "idle" } | { kind: "busy" } | { kind: "done"; message: string } | { kind: "error"; message: string };

/** Save… for one clip and Export all for a render: the native dialog picks, the API copies. */
export function useExport() {
  const [state, setState] = useState<ExportState>({ kind: "idle" });

  async function run(pick: () => Promise<string | null>, copy: (target: string) => Promise<string>) {
    if (!isTauri()) {
      setState({ kind: "error", message: "Saving files needs the ClipForge desktop app" });
      return;
    }
    try {
      const target = await pick();
      if (!target) return; // cancelled
      setState({ kind: "busy" });
      setState({ kind: "done", message: await copy(target) });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  return {
    state,
    saveClip: (clip: { id: string; title: string }) =>
      run(
        () => pickSaveFile(clip.title),
        async (destination) => `Saved to ${(await rendersApi.exportClip(clip.id, destination)).path}`,
      ),
    exportAll: (renderId: string) =>
      run(pickExportFolder, async (directory) => {
        const { paths } = await rendersApi.exportAll(renderId, directory);
        return `Exported ${paths.length} clip${paths.length === 1 ? "" : "s"} to ${directory}`;
      }),
  };
}
