import { Upload } from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { pickVideoFiles } from "../file-picker";
import { type ImportFailure, useImportVideos } from "../queries";

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** Opens the native picker and starts one import per chosen file; shows the rejected files in a dialog. */
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
    <>
      <Button onClick={pickAndImport} disabled={importVideos.isPending}>
        <Upload aria-hidden />
        {importVideos.isPending ? "Starting import…" : "Import videos"}
      </Button>
      <AlertDialog open={failures.length > 0} onOpenChange={(open) => !open && setFailures([])}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {failures.length === 1 ? "A file could not be imported" : `${failures.length} files could not be imported`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <ul className="grid gap-2 text-left">
                {failures.map((failure) => (
                  <li key={failure.path}>
                    <span className="text-foreground font-medium">{fileName(failure.path)}:</span> {failure.reason}
                  </li>
                ))}
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
