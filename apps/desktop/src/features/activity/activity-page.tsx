import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { type ActivityItem, useActivity } from "./queries";

const KIND_LABEL: Record<ActivityItem["kind"], string> = { processing: "Processing", planning: "Planning clips", rendering: "Rendering" };
const FINISHED = ["COMPLETED", "FAILED", "CANCELLED"];

export function ActivityPage() {
  const activity = useActivity();
  const running = activity.data?.filter((a) => !FINISHED.includes(a.status)) ?? [];
  const recent = activity.data?.filter((a) => FINISHED.includes(a.status)) ?? [];
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Activity</h1>
        <p className="text-muted-foreground text-sm">Processing, clip planning and rendering across all your videos.</p>
      </div>
      {activity.isPending && <p className="text-muted-foreground text-sm">Loading activity…</p>}
      {activity.isError && (
        <p role="alert" className="text-destructive text-sm">
          Could not load activity: {activity.error.message}
        </p>
      )}
      {activity.data && (
        <>
          <Section title="Running" items={running} empty="Nothing is running." />
          <Section title="Recent" items={recent} empty="No finished work yet." />
        </>
      )}
    </div>
  );
}

function Section({ title, items, empty }: { title: string; items: ActivityItem[]; empty: string }) {
  return (
    <section aria-label={title} className="grid gap-2">
      <h2 className="font-medium">{title}</h2>
      <Card>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-muted-foreground text-sm">{empty}</p>
          ) : (
            <ul className="divide-y">
              {items.map((item) => (
                <ActivityRow key={`${item.kind}-${item.id}`} item={item} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const done = FINISHED.includes(item.status);
  return (
    <li className="flex flex-wrap items-center gap-3 py-2 text-sm">
      <Badge variant="outline">{KIND_LABEL[item.kind]}</Badge>
      <Link
        to="/projects/$projectId/videos/$videoId"
        params={{ projectId: item.projectId, videoId: item.videoId }}
        className="font-medium underline-offset-2 hover:underline"
      >
        {item.videoName}
      </Link>
      {done ? (
        <Badge variant={item.status === "FAILED" ? "destructive" : item.status === "COMPLETED" ? "secondary" : "outline"}>
          {item.status.toLowerCase()}
        </Badge>
      ) : (
        <span className="flex items-center gap-2">
          <Progress value={item.progress} aria-label={`${KIND_LABEL[item.kind]} ${item.videoName}`} className="w-32" />
          <span className="tabular-nums">{item.progress}%</span>
        </span>
      )}
      {item.errorMessage && <span className="text-muted-foreground truncate">{item.errorMessage}</span>}
      <span className="text-muted-foreground ml-auto text-xs">{new Date(item.updatedAt).toLocaleString()}</span>
    </li>
  );
}
