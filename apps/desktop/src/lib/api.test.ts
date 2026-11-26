import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError, ApiUnreachableError } from "./api";

const client = new ApiClient("http://api.test/v1");
const stubFetch = (impl: () => Promise<Response>) => vi.stubGlobal("fetch", vi.fn(impl));

afterEach(() => vi.unstubAllGlobals());

describe("ApiClient", () => {
  it("returns parsed JSON on success", async () => {
    stubFetch(async () => Response.json({ id: "p1" }));

    expect(await client.getJson("/projects/p1")).toEqual({ id: "p1" });
  });

  it("sends a JSON body with the method", async () => {
    stubFetch(async () => Response.json({ id: "p1" }, { status: 201 }));

    await client.sendJson("POST", "/projects", { name: "x" });

    expect(fetch).toHaveBeenCalledWith("http://api.test/v1/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"name":"x"}',
    });
  });

  it("returns undefined for 204 No Content", async () => {
    stubFetch(async () => new Response(null, { status: 204 }));

    expect(await client.sendJson("DELETE", "/projects/p1")).toBeUndefined();
  });

  it("turns a Nest error body into an ApiError with the server message", async () => {
    stubFetch(async () => Response.json({ message: "Project not found", statusCode: 404 }, { status: 404 }));

    await expect(client.getJson("/projects/x")).rejects.toMatchObject({ status: 404, message: "Project not found" });
  });

  it("joins validation messages without their field prefix", async () => {
    stubFetch(async () =>
      Response.json({ message: ["name: Name is required", "description: Too long"] }, { status: 400 }),
    );

    const error = await client.sendJson("POST", "/projects", {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe("Name is required. Too long");
  });

  it("falls back to the status when the body is not JSON", async () => {
    stubFetch(async () => new Response("oops", { status: 500 }));

    await expect(client.getJson("/x")).rejects.toThrow("Request failed (HTTP 500)");
  });

  it("raises ApiUnreachableError when fetch itself fails", async () => {
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));

    await expect(client.getJson("/x")).rejects.toBeInstanceOf(ApiUnreachableError);
  });
});
