import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Pencil } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { isNotFound, useDeleteProject, useProject, useUpdateProject } from "../queries";
import { DeleteProjectDialog } from "./delete-project-dialog";
import { ProjectFormDialog } from "./project-form-dialog";

export function ProjectPage({ projectId, children }: { projectId: string; children?: ReactNode }) {
  const project = useProject(projectId);
  const update = useUpdateProject(projectId);
  const remove = useDeleteProject();
  const navigate = useNavigate();

  if (project.isPending) return <p className="text-muted-foreground text-sm">Loading project…</p>;

  if (project.isError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="font-medium">
          {isNotFound(project.error) ? "Project not found" : `Could not load the project: ${project.error.message}`}
        </p>
        <BackToProjects />
      </div>
    );
  }

  const data = project.data;
  return (
    <section aria-labelledby="project-heading" className="max-w-5xl">
      <BackToProjects />
      <header className="mt-3 mb-8 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 id="project-heading" className="truncate text-2xl font-semibold tracking-tight">
            {data.name}
          </h1>
          {data.description && <p className="text-muted-foreground mt-1 text-sm">{data.description}</p>}
        </div>
        <div className="flex shrink-0 gap-2">
          <ProjectFormDialog
            title="Rename project"
            description="Change the project's name or description."
            submitLabel="Save"
            initial={data}
            onSubmit={(input) => update.mutateAsync(input)}
            trigger={
              <Button variant="outline">
                <Pencil aria-hidden />
                Rename
              </Button>
            }
          />
          <DeleteProjectDialog
            project={data}
            onConfirm={async () => {
              await remove.mutateAsync(projectId);
              await navigate({ to: "/projects" });
            }}
          />
        </div>
      </header>
      {children}
    </section>
  );
}

function BackToProjects() {
  return (
    <Link to="/projects" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm">
      <ArrowLeft className="size-4" aria-hidden />
      All projects
    </Link>
  );
}
