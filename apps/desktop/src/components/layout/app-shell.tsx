import { Link, Outlet } from "@tanstack/react-router";
import { Activity } from "lucide-react";
import { TitleBar } from "./title-bar";

export function AppShell() {
  return (
    <div className="flex h-screen flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <aside className="bg-sidebar text-sidebar-foreground w-56 shrink-0 border-r p-3">
          <nav aria-label="Main">
            <Link
              to="/status"
              className="hover:bg-sidebar-accent text-muted-foreground hover:text-foreground flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors"
              activeProps={{ className: "bg-sidebar-accent text-foreground font-medium" }}
            >
              <Activity className="size-4" aria-hidden />
              System status
            </Link>
          </nav>
        </aside>
        <main className="flex-1 overflow-auto p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
