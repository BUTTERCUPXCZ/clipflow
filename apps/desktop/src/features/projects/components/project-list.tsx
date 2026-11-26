import { FolderPlus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCreateProject, useProjects } from "../queries";
import { ProjectCard } from "./project-card";
import { ProjectFormDialog } from "./project-form-dialog";

export function ProjectList() {
  const projects = useProjects();

  return (
    <section aria-labelledby="projects-heading" className="max-w-5xl">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 id="projects-heading" className="text-2xl font-semibold tracking-tight">
            Projects
          </h1>
          <p className="text-muted-foreground text-sm">Group the footage you want to turn into clips.</p>
        </div>
        {!!projects.data?.length && <NewProjectButton />}
      </header>

      {projects.isPending && <p className="text-muted-foreground text-sm">Loading projects…</p>}

      {projects.isError && (
        <Card>
          <CardContent className="flex items-center justify-between gap-4">
            <p role="alert" className="text-destructive text-sm">
              Could not load projects: {projects.error.message}
            </p>
            <Button variant="outline" size="sm" onClick={() => projects.refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      {projects.data?.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <FolderPlus className="text-muted-foreground size-8" aria-hidden />
            <p className="font-medium">No projects yet</p>
            <p className="text-muted-foreground max-w-sm text-sm">
              Create a project, then import the long videos you want ClipForge to cut into short clips.
            </p>
            <NewProjectButton />
          </CardContent>
        </Card>
      )}

      {!!projects.data?.length && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.data.map((project) => (
            <li key={project.id}>
              <ProjectCard project={project} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NewProjectButton() {
  const create = useCreateProject();
  return (
    <ProjectFormDialog
      title="New project"
      description="Give the project a name. You can import videos into it next."
      submitLabel="Create project"
      onSubmit={(input) => create.mutateAsync(input)}
      trigger={
        <Button>
          <Plus aria-hidden />
          New project
        </Button>
      }
    />
  );
}
