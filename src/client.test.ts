import { afterEach, describe, expect, it, vi } from "vitest";
import { ApplicationClient } from "./client.js";
import { normalizeBaseUrl, validateSpacePath } from "./utils.js";

afterEach(() => vi.unstubAllGlobals());

describe("Application API client", () => {
  it("sends the scoped token as a bearer credential and refuses redirects", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), {
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const client = new ApplicationClient(
      "https://app.example.test",
      "secret-token",
    );
    await expect(client.json("/api/health")).resolves.toEqual({ status: "ok" });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://app.example.test/api/health");
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer secret-token",
    );
    expect(init.redirect).toBe("error");
  });

  it("routes selected-space calls through origin discovery while discovery stays at the origin", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { spaces: [] },
          { headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetch);
    const client = new ApplicationClient(
      "https://app.example.test",
      "secret-token",
    );
    await client.spaces();
    await client.inSpace("11111111-1111-4111-8111-111111111111", () =>
      client.json("/api/config"),
    );
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://app.example.test/api/mcp/spaces",
      "https://app.example.test/api/mcp/spaces/11111111-1111-4111-8111-111111111111/api/config",
    ]);
  });

  it("rejects paths that could escape the selected space after URL normalization", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal("fetch", fetch);
    const client = new ApplicationClient(
      "https://app.example.test",
      "secret-token",
    );
    const selected = "11111111-1111-4111-8111-111111111111";

    for (const path of [
      "/api/../../../mcp/spaces/22222222-2222-4222-8222-222222222222/api/config",
      "/api/%2e%2e/mcp/spaces/22222222-2222-4222-8222-222222222222/api/config",
      "/api/files/%2e%2e/private.md",
      "/api/files/%5c..%5cprivate.md",
      "/health",
      "//evil.example.test/api/config",
      "/api/files/Plan.md#fragment",
    ]) {
      await expect(
        client.inSpace(selected, () => client.json(path)),
      ).rejects.toThrow(/stay within \/api\//);
    }
    expect(fetch).not.toHaveBeenCalled();
    await expect(client.json("/api/files/%E0%A4%A")).rejects.toThrow(
      /valid absolute API paths/,
    );
  });

  it("keeps discovery at the origin and adds JSON headers for request bodies", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ spaces: [] }))
      .mockResolvedValueOnce(Response.json({ status: "ok" }));
    vi.stubGlobal("fetch", fetch);
    const client = new ApplicationClient("https://app.example.test", "token");
    const selected = "11111111-1111-4111-8111-111111111111";

    await client.inSpace(selected, () => client.spaces());
    await client.inSpace(selected, () =>
      client.json("/api/files/Plan.md", { method: "PUT", body: "plan" }),
    );

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://app.example.test/api/mcp/spaces",
      `https://app.example.test/api/mcp/spaces/${selected}/api/files/Plan.md`,
    ]);
    expect(
      new Headers(fetch.mock.calls[1]?.[1]?.headers).get("content-type"),
    ).toBe("application/json");
  });

  it("preserves encoded path separators used by Application identifiers", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal("fetch", fetch);
    const client = new ApplicationClient(
      "https://app.example.test",
      "secret-token",
    );
    const selected = "11111111-1111-4111-8111-111111111111";
    await client.inSpace(selected, () =>
      client.json("/api/board/tasks/task%2F1"),
    );
    expect(fetch).toHaveBeenCalledWith(
      `https://app.example.test/api/mcp/spaces/${selected}/api/board/tasks/task%2F1`,
      expect.any(Object),
    );
  });

  it("rejects blank tokens and malformed discovery responses", async () => {
    expect(
      () => new ApplicationClient("https://app.example.test", "   "),
    ).toThrow(/API token is required/);

    const client = new ApplicationClient("https://app.example.test", "token");
    for (const value of [
      null,
      {},
      { spaces: "not-an-array" },
      { spaces: [{}] },
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(value)));
      await expect(client.spaces()).rejects.toThrow(
        /invalid space discovery response/,
      );
    }
  });

  it("keeps simultaneous calls isolated to their selected space", async () => {
    const urls: string[] = [];
    let completed = 0;
    let release!: () => void;
    const bothRequests = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        completed += 1;
        if (completed === 2) release();
        await bothRequests;
        return Response.json({});
      }),
    );
    const client = new ApplicationClient(
      "https://app.example.test",
      "secret-token",
    );
    const first = "11111111-1111-4111-8111-111111111111";
    const second = "22222222-2222-4222-8222-222222222222";
    await Promise.all([
      client.inSpace(first, async () => {
        await Promise.resolve();
        return client.json("/api/config");
      }),
      client.inSpace(second, async () => {
        await Promise.resolve();
        return client.json("/api/config");
      }),
    ]);
    expect(urls.sort()).toEqual(
      [
        `https://app.example.test/api/mcp/spaces/${first}/api/config`,
        `https://app.example.test/api/mcp/spaces/${second}/api/config`,
      ].sort(),
    );
  });

  it("selects a sole accessible space and requires an explicit choice for multiple spaces", async () => {
    const client = new ApplicationClient(
      "https://app.example.test",
      "secret-token",
    );
    const one = vi.spyOn(client, "spaces").mockResolvedValue([
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Only",
        permissions: ["content.read"],
      },
    ]);
    await expect(client.resolveSpace()).resolves.toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    one.mockResolvedValue([
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "One",
        permissions: ["content.read"],
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Two",
        permissions: ["content.read"],
      },
    ]);
    await expect(client.resolveSpace()).rejects.toThrow(/spaceId/);
    await expect(
      client.resolveSpace("22222222-2222-4222-8222-222222222222"),
    ).resolves.toBe("22222222-2222-4222-8222-222222222222");
    await expect(client.resolveSpace("invalid")).rejects.toThrow(/spaceId/);
    one.mockResolvedValue([]);
    await expect(client.resolveSpace()).rejects.toThrow(/no accessible spaces/);
    expect(() => client.inSpace("invalid", async () => undefined)).toThrow(
      /spaceId/,
    );
  });

  it("handles empty and malformed JSON, and rejects oversized bodies", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response("not-json"))
      .mockResolvedValueOnce(new Response("too large"));
    vi.stubGlobal("fetch", fetch);
    const client = new ApplicationClient("https://app.example.test", "token");

    await expect(client.json("/api/health")).resolves.toBeNull();
    await expect(client.json("/api/health")).rejects.toThrow(/invalid JSON/);
    await expect(client.bytes("/api/files/a", 2)).rejects.toThrow(
      /2-byte limit/,
    );
  });

  it("returns bounded byte, text, and header responses with content type fallbacks", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("image", {
          headers: {
            "x-content-type": "image/png",
            "content-type": "text/plain",
          },
        }),
      )
      .mockResolvedValueOnce(new Response("text body"))
      .mockResolvedValueOnce(
        new Response("bytes", { headers: { "content-type": "text/plain" } }),
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal("fetch", fetch);
    const client = new ApplicationClient("https://app.example.test", "token");

    await expect(client.bytes("/api/image", 10)).resolves.toMatchObject({
      contentType: "image/png",
    });
    await expect(client.text("/api/text")).resolves.toMatchObject({
      text: "text body",
    });
    await expect(client.bytes("/api/file", 100)).resolves.toMatchObject({
      contentType: "text/plain",
    });
    await expect(client.bytes("/api/file", 100)).resolves.toMatchObject({
      contentType: "application/octet-stream",
    });
  });

  it("normalizes API error details and bounds error bodies across methods", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: { message: "nested detail" } }, { status: 403 }),
      )
      .mockResolvedValueOnce(Response.json({ message: 12 }, { status: 403 }))
      .mockResolvedValueOnce(Response.json("denied", { status: 403 }))
      .mockResolvedValueOnce(Response.json(null, { status: 500 }))
      .mockResolvedValueOnce(new Response("x".repeat(700), { status: 500 }))
      .mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(new Response("", { status: 502 }))
      .mockResolvedValueOnce(
        Response.json({ message: "attachment denied" }, { status: 403 }),
      );
    vi.stubGlobal("fetch", fetch);
    const client = new ApplicationClient("https://app.example.test", "token");

    await expect(client.json("/api/a")).rejects.toThrow(/nested detail/);
    await expect(client.json("/api/a")).rejects.toThrow(/"message":12/);
    await expect(client.json("/api/a")).rejects.toThrow(/denied/);
    await expect(client.json("/api/a")).rejects.toThrow(/null/);
    await expect(client.text("/api/a")).rejects.toThrow(/x{500}$/);
    await expect(client.head("/api/a")).rejects.toThrow(/missing/);
    await expect(client.json("/api/a")).rejects.toThrow(/HTTP 502/);
    await expect(client.bytes("/api/file", 10)).rejects.toThrow(
      /attachment denied/,
    );
  });

  it("uses caller cancellation alongside the client timeout", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ status: "ok" }));
    vi.stubGlobal("fetch", fetch);
    const client = new ApplicationClient("https://app.example.test", "token");
    const controller = new AbortController();

    await client.json("/api/health", { signal: controller.signal });

    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(init.signal).not.toBe(controller.signal);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports Application error details without including credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: "Forbidden", message: "content.write is required" },
            { status: 403 },
          ),
        ),
    );
    const client = new ApplicationClient(
      "https://app.example.test",
      "top-secret",
    );
    await expect(client.json("/api/files/Plan.md")).rejects.toThrow(
      "content.write is required",
    );
    await expect(client.json("/api/files/Plan.md")).rejects.not.toThrow(
      "top-secret",
    );
  });

  it("accepts only a service origin and rejects non-HTTP, credentialed, or queried URLs", () => {
    expect(normalizeBaseUrl("https://app.example.test/")).toBe(
      "https://app.example.test",
    );
    expect(normalizeBaseUrl("http://localhost:3000/api")).toBe(
      "http://localhost:3000",
    );
    expect(() =>
      normalizeBaseUrl("https://app.example.test/team/api/"),
    ).toThrow(/without a space path/);
    expect(() => normalizeBaseUrl("file:///tmp/application")).toThrow(
      /HTTP\(S\)/,
    );
    expect(() =>
      normalizeBaseUrl("https://user:pass@app.example.test"),
    ).toThrow(/HTTP\(S\)/);
    expect(() =>
      normalizeBaseUrl("https://app.example.test/?token=secret"),
    ).toThrow(/HTTP\(S\)/);
    expect(() => normalizeBaseUrl("http://app.example.test")).toThrow(/HTTPS/);
    expect(() => normalizeBaseUrl("not a URL")).toThrow(/absolute HTTP\(S\)/);
  });

  it("accepts visible relative paths and rejects traversal and hidden paths", () => {
    expect(validateSpacePath("Projects/Plan.md")).toBe("Projects/Plan.md");
    for (const path of [
      "../secret",
      "/absolute",
      "Folder/../secret",
      ".private",
      "Folder/.hidden",
      "Folder\\file",
      "Folder/line\nfeed",
      "Folder/tab\tname",
    ]) {
      expect(() => validateSpacePath(path)).toThrow();
    }
  });
});
