import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockApi, renderWithProviders } from "@/test/render";
import { ImportButton } from "./import-button";

const picker = vi.hoisted(() => ({ paths: [] as string[] }));
vi.mock("../file-picker", () => ({ pickVideoFiles: async () => picker.paths }));

beforeEach(() => {
  picker.paths = [];
});
afterEach(() => vi.unstubAllGlobals());

describe("ImportButton", () => {
  it("does nothing when the picker is cancelled", async () => {
    const fetchMock = mockApi({});

    renderWithProviders(<ImportButton projectId="p1" />);
    fireEvent.click(await screen.findByRole("button", { name: /import videos/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /import videos/i })).toBeEnabled());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("imports every picked file and lists the ones the API rejected", async () => {
    picker.paths = ["/media/a.mp4", "/media/notes.txt", "/media/b.mov"];
    const imported: string[] = [];
    mockApi({
      "POST /projects/p1/videos/import": (body) => {
        const { path } = body as { path: string };
        if (path.endsWith(".txt")) {
          return Response.json({ message: 'Unsupported file type ".txt"' }, { status: 400 });
        }
        imported.push(path);
        return Response.json({ id: path, status: "IMPORTING" }, { status: 202 });
      },
      "GET /projects/p1/videos": () => Response.json([]),
      "GET /projects": () => Response.json([]),
    });

    renderWithProviders(<ImportButton projectId="p1" />);
    fireEvent.click(await screen.findByRole("button", { name: /import videos/i }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("A file could not be imported");
    expect(dialog).toHaveTextContent('notes.txt: Unsupported file type ".txt"');
    expect(imported).toEqual(["/media/a.mp4", "/media/b.mov"]);

    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });
});
