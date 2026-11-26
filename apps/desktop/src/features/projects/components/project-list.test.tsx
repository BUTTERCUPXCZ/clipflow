import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi, renderWithProviders } from "@/test/render";
import type { ProjectSummary } from "../api";
import { ProjectList } from "./project-list";

const summary = (name: string, videoCount = 0): ProjectSummary => ({
  id: `id-${name}`,
  name,
  description: null,
  createdAt: "2026-11-26T05:00:00.000Z",
  updatedAt: "2026-11-26T05:00:00.000Z",
  videoCount,
});

afterEach(() => vi.unstubAllGlobals());

async function openNewProjectDialog() {
  fireEvent.click(await screen.findByRole("button", { name: /new project/i }));
  return screen.findByRole("dialog");
}

describe("ProjectList", () => {
  it("shows an empty state with a call to action", async () => {
    mockApi({ "GET /projects": () => Response.json([]) });

    renderWithProviders(<ProjectList />);

    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new project/i })).toBeInTheDocument();
  });

  it("lists projects as cards linking to their page", async () => {
    mockApi({ "GET /projects": () => Response.json([summary("Podcast", 2), summary("Lecture", 1)]) });

    renderWithProviders(<ProjectList />);

    const link = await screen.findByRole("link", { name: /podcast/i });
    expect(link).toHaveAttribute("href", "/projects/id-Podcast");
    expect(screen.getByText(/2 videos/)).toBeInTheDocument();
    expect(screen.getByText(/1 video ·/)).toBeInTheDocument();
  });

  it("shows the error with a retry when projects cannot load", async () => {
    mockApi({ "GET /projects": () => Response.json({ message: "boom" }, { status: 500 }) });

    renderWithProviders(<ProjectList />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load projects: boom");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it.each([
    ["   ", "Name is required"],
    ["x".repeat(101), "at most 100 characters"],
  ])("rejects the name %j inline without calling the API", async (name, message) => {
    const fetchMock = mockApi({ "GET /projects": () => Response.json([]) });
    renderWithProviders(<ProjectList />);
    await openNewProjectDialog();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: name } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the initial list
  });

  it("creates a project and refreshes the list", async () => {
    let projects: ProjectSummary[] = [];
    const created = vi.fn();
    mockApi({
      "GET /projects": () => Response.json(projects),
      "POST /projects": (body) => {
        created(body);
        projects = [summary("Podcast")];
        return Response.json(projects[0], { status: 201 });
      },
    });
    renderWithProviders(<ProjectList />);
    await openNewProjectDialog();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  Podcast  " } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(await screen.findByRole("link", { name: /podcast/i })).toBeInTheDocument();
    expect(created).toHaveBeenCalledWith({ name: "Podcast", description: null });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("keeps the dialog open and shows the server's reason when creation fails", async () => {
    mockApi({
      "GET /projects": () => Response.json([]),
      "POST /projects": () => Response.json({ message: ["name: Name is required"] }, { status: 400 }),
    });
    renderWithProviders(<ProjectList />);
    await openNewProjectDialog();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "ok" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Name is required");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
