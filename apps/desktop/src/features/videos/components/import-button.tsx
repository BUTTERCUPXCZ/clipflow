import { Upload } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { pickVideoFiles } from "../file-picker";
import { type ImportFailure, useImportVideos } from "../queries";

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** Opens the native picker and starts one import per chosen file; lists the files the API rejected. */
export function ImportButton({ projectId }: { projectId: string }) {
  const importVideos = useImportVideos(projectId);
  const [failures, setFailures] = useState<ImportFailure[]>([]);

  async function pickAndImport() {
    let paths: string[];
    try {
      paths = await pickVideoFiles();
    } catch (error) {
      setFailures([{ path: "File picker", reason: error instanceof Error ? error.message : String(error) }]);
      return;
    }
    if (!paths.length) return;
    setFailures(await importVideos.mutateAsync(paths));
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button onClick={pickAndImport} disabled={importVideos.isPending}>
        <Upload aria-hidden />
        {importVideos.isPending ? "Starting import…" : "Import videos"}
      </Button>
      {failures.length > 0 && (
        <ul role="alert" className="text-destructive max-w-md text-right text-sm">
          {failures.map((failure) => (
            <li key={failure.path}>
              <span className="font-medium">{fileName(failure.path)}:</span> {failure.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
