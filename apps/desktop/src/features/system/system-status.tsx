import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { fetchHealth } from "./api";
import { StatusBadge } from "./status-badge";
import { toStatusRows } from "./status-rows";

export function SystemStatus() {
  const health = useQuery({ queryKey: ["system", "health"], queryFn: fetchHealth });
  const rows = toStatusRows(health, api.baseUrl);

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
          {rows.map(({ label, check }) => (
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
