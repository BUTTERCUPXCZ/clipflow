import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const win = vi.hoisted(() => ({
  minimize: vi.fn(),
  toggleMaximize: vi.fn(),
  close: vi.fn(),
  isMaximized: vi.fn(async () => false),
  onResized: vi.fn(async () => () => {}),
}));
const tauri = vi.hoisted(() => ({ inside: true }));

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => win }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => tauri.inside }));

const { TitleBar } = await import("./title-bar");

beforeEach(() => {
  vi.clearAllMocks();
  tauri.inside = true;
});

describe("TitleBar", () => {
  it("wires the window controls to the Tauri window", async () => {
    render(<TitleBar />);

    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    fireEvent.click(await screen.findByRole("button", { name: "Maximize" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(win.minimize).toHaveBeenCalledOnce();
    expect(win.toggleMaximize).toHaveBeenCalledOnce();
    expect(win.close).toHaveBeenCalledOnce();
  });

  it("offers Restore when the window is maximized", async () => {
    win.isMaximized.mockResolvedValueOnce(true);
    render(<TitleBar />);

    expect(await screen.findByRole("button", { name: "Restore" })).toBeInTheDocument();
  });

  it("renders no window controls outside Tauri (plain browser dev)", () => {
    tauri.inside = false;
    render(<TitleBar />);

    expect(screen.getByText("ClipForge")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
