import { CircleCheck, CircleX, LoaderCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Check } from "./api";

export function StatusBadge({ check }: { check: Check | undefined }) {
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
