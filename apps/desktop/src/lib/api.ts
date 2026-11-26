/** fetch() itself failed: the API is not running or not reachable. */
export class ApiUnreachableError extends Error {
  constructor(
    readonly baseUrl: string,
    cause: unknown,
  ) {
    super(`Cannot reach the ClipForge API at ${baseUrl}`, { cause });
    this.name = "ApiUnreachableError";
  }
}

/**
 * The one gateway to the NestJS API (architecture §5.1: the desktop talks to nothing else).
 * Feature API modules depend on this client instead of calling fetch() themselves.
 */
export class ApiClient {
  constructor(readonly baseUrl: string) {}

  async request(path: string, init?: RequestInit): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}${path}`, init);
    } catch (cause) {
      throw new ApiUnreachableError(this.baseUrl, cause);
    }
  }
}

export const api = new ApiClient(import.meta.env.VITE_API_URL ?? "http://localhost:3000/api/v1");
