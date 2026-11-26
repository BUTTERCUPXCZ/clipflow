import { useQuery } from "@tanstack/react-query";
import { CircleCheck, CircleX, LoaderCircle, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { API_URL, ApiUnreachableError } from "@/lib/api";
import { type Check, fetchHealth, type HealthReport } from "./api";

const LABELS: Record<keyof HealthReport["checks"], string> = {
  database: "PostgreSQL",
  ai_service: "AI service (gRPC)",
  model_runtime: "Ollama runtime",
  vision_model: "Vision model",
};

export function SystemStatus() {
  const health = useQuery({ queryKey: ["system", "health"], queryFn: fetchHealth });

  const unreachable = health.error instanceof ApiUnreachableError;

  let apiCheck: Check | undefined;
  if (health.isError) {
    apiCheck = error(
      unreachable ? `API unreachable at ${API_URL}. Is it running? (npm run dev:api)` : health.error.message,
    );
  } else if (!health.isPending) {
    apiCheck = { status: "ok", detail: API_URL };
  }

  // On error, ignore `data`: TanStack keeps the last successful report after a failed refetch.
  const dependencyCheck = (key: keyof HealthReport["checks"]): Check | undefined =>
    health.isError
      ? error(unreachable ? "unknown: API unreachable" : "unknown: health check failed")
      : health.data?.checks[key];

  const rows: [string, Check | undefined][] = [
    ["NestJS API", apiCheck],
    ...(Object.keys(LABELS) as (keyof HealthReport["checks"])[]).map(
      (key): [string, Check | undefined] => [LABELS[key], dependencyCheck(key)],
    ),
  ];

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>System status</CardTitle>
        <CardDescription>Every service ClipForge needs to process videos locally.</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={() => health.refetch()} disabled={health.isFetching}>
            <RefreshCw className={health.isFetching ? "animate-spin" : undefined} aria-hidden />
            Refresh
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {rows.map(([label, check]) => (
            <li key={label} className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="font-medium">{label}</p>
                <p className="text-muted-foreground text-sm break-words">{check?.detail ?? "Checking…"}</p>
              </div>
              <StatusBadge check={check} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function error(detail: string): Check {
  return { status: "error", detail };
}

function StatusBadge({ check }: { check: Check | undefined }) {
  if (!check) {
    return (
      <Badge variant="outline">
        <LoaderCircle className="animate-spin" aria-hidden />
        Checking
      </Badge>
    );
  }
  return check.status === "ok" ? (
    <Badge variant="secondary">
      <CircleCheck className="text-emerald-600" aria-hidden />
      OK
    </Badge>
  ) : (
    <Badge variant="destructive">
      <CircleX aria-hidden />
      Error
    </Badge>
  );
}
