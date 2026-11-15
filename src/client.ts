import { AsyncLocalStorage } from "node:async_hooks";
import { normalizeBaseUrl } from "./utils.js";

const MAX_ERROR_BYTES = 64 * 1024;
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const SPACE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const API_ORIGIN = "https://app.invalid";

function validateApiPath(path: string): void {
  const queryStart = path.indexOf("?");
  const pathname = queryStart < 0 ? path : path.slice(0, queryStart);
  let resolved: URL;
  let decodedPath: string;
  try {
    resolved = new URL(path, API_ORIGIN);
    decodedPath = decodeURIComponent(pathname);
  } catch {
    throw new Error("API paths must be valid absolute API paths");
  }
  if (
    !path.startsWith("/api/") ||
    path.startsWith("//") ||
    path.includes("#") ||
    resolved.origin !== API_ORIGIN ||
    resolved.pathname !== pathname ||
    !resolved.pathname.startsWith("/api/") ||
    decodedPath.split("/").some(
      (segment) =>
        segment === "." ||
        segment === ".." ||
        segment.includes("\\") ||
        [...segment].some((character) => {
          const code = character.charCodeAt(0);
          return code < 0x20 || code === 0x7f;
        }),
    )
  ) {
    throw new Error("API paths must stay within /api/");
  }
}

export type ApplicationSpace = {
  id: string;
  name: string;
  permissions: string[];
};

export type ApplicationResponse = {
  readonly bytes: Uint8Array;
  readonly headers: Headers;
  readonly contentType: string;
};

/** Small bearer-authenticated client for the compatible workspace space API. */
export class ApplicationClient {
  readonly baseUrl: string;
  readonly #token: string;
  readonly #space = new AsyncLocalStorage<string>();

  constructor(baseUrl: string, token: string) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    if (!token.trim()) throw new Error("An API token is required");
    this.#token = token.trim();
  }

  async spaces(): Promise<ApplicationSpace[]> {
    const result = await this.json<{ spaces?: unknown }>("/api/mcp/spaces");
    if (
      !result ||
      !Array.isArray(result.spaces) ||
      !result.spaces.every(
        (space) =>
          space &&
          typeof space === "object" &&
          SPACE_ID.test((space as ApplicationSpace).id) &&
          typeof (space as ApplicationSpace).name === "string" &&
          Array.isArray((space as ApplicationSpace).permissions) &&
          (space as ApplicationSpace).permissions.every(
            (permission) => typeof permission === "string",
          ),
      )
    ) {
      throw new Error("The API returned an invalid space discovery response");
    }
    return result.spaces as ApplicationSpace[];
  }

  async resolveSpace(spaceId?: string): Promise<string> {
    if (spaceId !== undefined) {
      if (!SPACE_ID.test(spaceId))
        throw new Error("spaceId must be a valid space ID");
      return spaceId;
    }
    const spaces = await this.spaces();
    if (spaces.length === 1) return spaces[0]!.id;
    if (spaces.length === 0) {
      throw new Error("This API token has no accessible spaces");
    }
    throw new Error(
      "Choose an accessible space with the spaceId argument, or call list_spaces first",
    );
  }

  inSpace<T>(spaceId: string, operation: () => Promise<T>): Promise<T> {
    if (!SPACE_ID.test(spaceId))
      throw new Error("spaceId must be a valid space ID");
    return this.#space.run(spaceId, operation);
  }

  async json<T = unknown>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.request(path, init);
    const bytes = await readBounded(response, MAX_JSON_BYTES);
    if (!response.ok) throw apiError(path, response, bytes);
    if (bytes.length === 0) return null as T;
    try {
      const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.hasOwn(value, "data")
      ) {
        return (value as { data: T }).data;
      }
      return value as T;
    } catch {
      throw new Error(`${path}: The API returned invalid JSON`);
    }
  }

  async bytes(path: string, maxBytes: number): Promise<ApplicationResponse> {
    const response = await this.request(path);
    const bytes = await readBounded(
      response,
      response.ok ? maxBytes : MAX_ERROR_BYTES,
    );
    if (!response.ok) throw apiError(path, response, bytes);
    return {
      bytes,
      headers: response.headers,
      contentType:
        response.headers.get("x-content-type") ??
        response.headers.get("content-type") ??
        "application/octet-stream",
    };
  }

  async text(
    path: string,
    init?: RequestInit,
  ): Promise<{ text: string; headers: Headers }> {
    const response = await this.request(path, init);
    const bytes = await readBounded(
      response,
      response.ok ? MAX_JSON_BYTES : MAX_ERROR_BYTES,
    );
    if (!response.ok) throw apiError(path, response, bytes);
    return { text: new TextDecoder().decode(bytes), headers: response.headers };
  }

  async head(path: string, headers?: HeadersInit): Promise<Headers> {
    const response = await this.request(path, { method: "HEAD", headers });
    if (!response.ok) {
      throw apiError(
        path,
        response,
        await readBounded(response, MAX_ERROR_BYTES),
      );
    }
    return response.headers;
  }

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    validateApiPath(path);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.#token}`);
    headers.set("Accept", "application/json, text/plain, */*");
    if (init.body != null && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const timeout = AbortSignal.timeout(15_000);
    const signal = init.signal
      ? AbortSignal.any([init.signal, timeout])
      : timeout;
    const spaceId = this.#space.getStore();
    const endpoint =
      spaceId && path !== "/api/mcp/spaces"
        ? `${this.baseUrl}/api/mcp/spaces/${encodeURIComponent(spaceId)}${path}`
        : `${this.baseUrl}${path}`;
    return fetch(endpoint, {
      ...init,
      headers,
      signal,
      redirect: "error",
    });
  }
}

async function readBounded(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error(`API response exceeds the ${maxBytes}-byte limit`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function apiError(path: string, response: Response, bytes: Uint8Array): Error {
  const body = new TextDecoder().decode(bytes).trim();
  let message = `HTTP ${response.status}`;
  if (body) {
    try {
      const parsed: unknown = JSON.parse(body);
      if (parsed && typeof parsed === "object") {
        const record = parsed as Record<string, unknown>;
        const nested = record.error;
        const nestedMessage =
          nested && typeof nested === "object"
            ? (nested as Record<string, unknown>).message
            : undefined;
        const detail = record.message ?? nestedMessage;
        if (typeof detail === "string") message = detail;
        else message = JSON.stringify(parsed);
      } else {
        message = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
      }
    } catch {
      message = body.slice(0, 500);
    }
  }
  return new Error(`${path}: ${message}`);
}
