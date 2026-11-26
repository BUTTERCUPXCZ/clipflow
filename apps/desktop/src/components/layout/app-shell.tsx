import { Link, Outlet } from "@tanstack/react-router";
import { Activity, FolderOpen, type LucideIcon, Clapperboard, ListChecks } from "lucide-react";
import { useLiveJobUpdates } from "@/features/jobs/queries";
import { liveEvents } from "@/lib/live-events";
import { TitleBar } from "./title-bar";

const NAV: { to: "/projects" | "/clips" | "/activity" | "/status"; label: string; icon: LucideIcon }[] = [
  { to: "/projects", label: "Projects", icon: FolderOpen },
  { to: "/clips", label: "Clips", icon: Clapperboard },
  { to: "/activity", label: "Activity", icon: ListChecks },
  { to: "/status", label: "System status", icon: Activity },
];

export function AppShell() {
  useLiveJobUpdates(liveEvents);
  return (
    <div className="flex h-screen flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <aside className="bg-sidebar text-sidebar-foreground w-56 shrink-0 border-r p-3">
          <nav aria-label="Main" className="grid gap-1">
            {NAV.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className="hover:bg-sidebar-accent text-muted-foreground hover:text-foreground flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors"
                activeProps={{ className: "bg-sidebar-accent text-foreground font-medium" }}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            ))}
          </nav>
        </aside>
        <main className="flex-1 overflow-auto p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
