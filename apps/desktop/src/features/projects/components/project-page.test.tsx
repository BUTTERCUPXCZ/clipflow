import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi, renderWithProviders } from "@/test/render";
import type { Project } from "../api";
import { ProjectPage } from "./project-page";

const project: Project = {
  id: "p1",
  name: "Podcast",
  description: "Episode 12 raw",
  createdAt: "2026-11-26T05:00:00.000Z",
  updatedAt: "2026-11-26T05:00:00.000Z",
};

afterEach(() => vi.unstubAllGlobals());

describe("ProjectPage", () => {
  it("shows the project name and description", async () => {
    mockApi({ "GET /projects/p1": () => Response.json(project) });

    renderWithProviders(<ProjectPage projectId="p1" />);

    expect(await screen.findByRole("heading", { name: "Podcast" })).toBeInTheDocument();
    expect(screen.getByText("Episode 12 raw")).toBeInTheDocument();
  });

  it("shows 'Project not found' with a way back for an unknown id", async () => {
    mockApi({ "GET /projects/p1": () => Response.json({ message: "Project not found" }, { status: 404 }) });

    renderWithProviders(<ProjectPage projectId="p1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Project not found");
    expect(screen.getByRole("link", { name: /all projects/i })).toHaveAttribute("href", "/projects");
  });

  it("renames the project through the pre-filled dialog", async () => {
    const patched = vi.fn();
    let current = project;
    mockApi({
      "GET /projects/p1": () => Response.json(current),
      "PATCH /projects/p1": (body) => {
        patched(body);
        current = { ...project, name: "Podcast — final" };
        return Response.json(current);
      },
      "GET /projects": () => Response.json([]),
    });
    renderWithProviders(<ProjectPage projectId="p1" />);

    fireEvent.click(await screen.findByRole("button", { name: /rename/i }));
    const name = screen.getByLabelText("Name");
    expect(name).toHaveValue("Podcast");
    fireEvent.change(name, { target: { value: "Podcast — final" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("heading", { name: "Podcast — final" })).toBeInTheDocument();
    expect(patched).toHaveBeenCalledWith({ name: "Podcast — final", description: "Episode 12 raw" });
  });

  it("does nothing when the delete is cancelled", async () => {
    const fetchMock = mockApi({ "GET /projects/p1": () => Response.json(project) });
    renderWithProviders(<ProjectPage projectId="p1" />);

    fireEvent.click(await screen.findByRole("button", { name: /delete/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(fetchMock.mock.calls.every(([, init]) => (init?.method ?? "GET") === "GET")).toBe(true);
  });

  it("deletes after confirmation and returns to the project list", async () => {
    mockApi({
      "GET /projects/p1": () => Response.json(project),
      "DELETE /projects/p1": () => new Response(null, { status: 204 }),
      "GET /projects": () => Response.json([]),
    });
    const { router } = renderWithProviders(<ProjectPage projectId="p1" />, { path: "/projects/p1" });

    fireEvent.click(await screen.findByRole("button", { name: /delete/i }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("Delete “Podcast”?");
    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/projects"));
  });
});
