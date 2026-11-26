/** Base URL of the NestJS API. All backend access goes through it (architecture §5.1). */
export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000/api/v1";

/** fetch() itself failed: the API is not running or not reachable. */
export class ApiUnreachableError extends Error {
  constructor(cause: unknown) {
    super(`Cannot reach the ClipForge API at ${API_URL}`, { cause });
    this.name = "ApiUnreachableError";
  }
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_URL}${path}`, init);
  } catch (cause) {
    throw new ApiUnreachableError(cause);
  }
}
