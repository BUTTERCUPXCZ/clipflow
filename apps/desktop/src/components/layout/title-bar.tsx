import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Film, Minus, Square, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * App-drawn window chrome (tauri.conf.json sets `decorations: false`).
 * `data-tauri-drag-region` applies only to the element that carries it, so it sits on the bar and
 * on every non-interactive child; double-clicking a drag region toggles maximize.
 */
export function TitleBar() {
  return (
    <header
      data-tauri-drag-region
      className="bg-sidebar text-sidebar-foreground flex h-10 shrink-0 items-center border-b select-none"
    >
      <div data-tauri-drag-region className="flex items-center gap-2.5 pl-4">
        <span
          data-tauri-drag-region
          className="bg-primary text-primary-foreground grid size-6 place-items-center rounded-md shadow-sm"
        >
          <Film className="pointer-events-none size-3.5" strokeWidth={2.25} aria-hidden />
        </span>
        <span data-tauri-drag-region className="text-sm font-semibold tracking-tight">
          ClipForge <span className="text-muted-foreground pointer-events-none font-medium">AI</span>
        </span>
      </div>
      <div data-tauri-drag-region className="h-full flex-1" />
      {isTauri() && <WindowControls />}
    </header>
  );
}

function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    let disposed = false;
    const sync = () => win.isMaximized().then(setMaximized);
    sync();
    win.onResized(sync).then((fn) => (disposed ? fn() : (unlisten = fn)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const win = getCurrentWindow();
  return (
    <div className="flex h-full">
      <ControlButton label="Minimize" onClick={() => win.minimize()}>
        <Minus />
      </ControlButton>
      <ControlButton label={maximized ? "Restore" : "Maximize"} onClick={() => win.toggleMaximize()}>
        {maximized ? <Copy className="-scale-x-100" /> : <Square className="size-3.5!" />}
      </ControlButton>
      <ControlButton label="Close" onClick={() => win.close()} danger>
        <X />
      </ControlButton>
    </div>
  );
}

function ControlButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "text-muted-foreground inline-flex h-full w-12 items-center justify-center transition-colors duration-150",
        "focus-visible:ring-ring/60 outline-none focus-visible:ring-2 focus-visible:ring-inset",
        "[&_svg]:size-4 [&_svg]:stroke-[1.75] [&_svg]:transition-transform active:[&_svg]:scale-90",
        danger
          ? "hover:bg-destructive hover:text-white active:bg-destructive/85"
          : "hover:bg-sidebar-accent hover:text-foreground active:bg-sidebar-accent/70",
      )}
    >
      {children}
    </button>
  );
}
