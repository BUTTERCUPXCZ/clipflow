import { Link } from "@tanstack/react-router";
import { Film } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProjectSummary } from "../api";

const updatedFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function ProjectCard({ project }: { project: ProjectSummary }) {
  const videos = `${project.videoCount} ${project.videoCount === 1 ? "video" : "videos"}`;
  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId: project.id }}
      className="focus-visible:ring-ring/50 block rounded-xl outline-none focus-visible:ring-[3px]"
    >
      <Card className="hover:border-foreground/20 h-full transition-[border-color,transform] duration-150 hover:-translate-y-0.5">
        <CardHeader>
          <CardTitle className="truncate">{project.name}</CardTitle>
          {project.description && <CardDescription className="line-clamp-2">{project.description}</CardDescription>}
          <p className="text-muted-foreground mt-2 flex items-center gap-1.5 text-xs">
            <Film className="size-3.5" aria-hidden />
            {videos} · Updated {updatedFormat.format(new Date(project.updatedAt))}
          </p>
        </CardHeader>
      </Card>
    </Link>
  );
}
