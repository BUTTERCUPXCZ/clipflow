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

/** The API answered with an error status. `message` is the server's own explanation when it sent one. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Reads Nest's error body: `{ message: string | string[] }` (validation errors are an array of "field: reason"). */
  static async from(res: Response): Promise<ApiError> {
    const body: unknown = await res.json().catch(() => undefined);
    const message = (body as { message?: unknown } | undefined)?.message;
    const text = Array.isArray(message)
      ? message.map((m) => String(m).replace(/^[\w.]+: /, "")).join(". ")
      : typeof message === "string"
        ? message
        : `Request failed (HTTP ${res.status})`;
    return new ApiError(res.status, text);
  }
}

type Method = "POST" | "PATCH" | "DELETE";

/**
 * The one gateway to the NestJS API (architecture §5.1: the desktop talks to nothing else).
 * Feature API classes depend on this client instead of calling fetch() themselves.
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

  async getJson<T>(path: string): Promise<T> {
    return this.parse<T>(await this.request(path));
  }

  async sendJson<T>(method: Method, path: string, body?: unknown): Promise<T> {
    const init: RequestInit =
      body === undefined
        ? { method }
        : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
    return this.parse<T>(await this.request(path, init));
  }

  private async parse<T>(res: Response): Promise<T> {
    if (!res.ok) throw await ApiError.from(res);
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }
}

export const api = new ApiClient(import.meta.env.VITE_API_URL ?? "http://localhost:3000/api/v1");
