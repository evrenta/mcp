import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ApplicationClient } from "./client.js";
import { registerTools } from "./tools.js";

type RegisteredTool = {
  description: string;
  inputSchema: import("zod").ZodObject;
  handler: (args: unknown) => Promise<{
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  }>;
};

function fixture(client: Partial<ApplicationClient> = {}) {
  const scopedClient = {
    spaces: vi.fn(async () => []),
    resolveSpace: vi.fn(
      async (spaceId?: string) =>
        spaceId ?? "11111111-1111-4111-8111-111111111111",
    ),
    inSpace: vi.fn(
      async (_spaceId: string, operation: () => Promise<unknown>) =>
        operation(),
    ),
    ...client,
  };
  const tools = new Map<string, RegisteredTool>();
  const server = {
    registerTool: vi.fn((name, config, handler) => {
      tools.set(name, {
        description: config.description,
        inputSchema: config.inputSchema,
        handler,
      });
    }),
  };
  registerTools(server as never, scopedClient as ApplicationClient);
  return { tools, client: scopedClient };
}

const validToolArgs: Record<string, Record<string, unknown>> = {
  list_spaces: {},
  whoami: {},
  list_files: {},
  get_file_metadata: { path: "Notes/a.md" },
  read_file: { path: "Notes/a.md" },
  write_file: { path: "Notes/a.md", content: "text", createOnly: true },
  reconcile_file: {
    path: "Notes/a.md",
    baseText: "old",
    proposedText: "new",
  },
  delete_file: { path: "Notes/a.md" },
  lookup_page: { path: "Notes/a.md" },
  get_page: { id: "page-id" },
  move_page_identity: { id: "page-id", from: "Notes/a.md", to: "Notes/b.md" },
  get_search_status: {},
  search: { query: "release plan" },
  list_file_revisions: { path: "Notes/a.md" },
  read_file_revision: { path: "Notes/a.md", revision: "a".repeat(40) },
  get_document_history: { path: "Notes/a.md" },
  read_document_version: { path: "Notes/a.md", revision: "snapshot-1" },
  checkpoint_document: { path: "Notes/a.md" },
  list_revision_history: {},
  delete_document_version: { path: "Notes/a.md", revision: "snapshot-1" },
  get_revision_log: {},
  create_revision_snapshot: {},
  get_revision_activity: {},
  get_revision_sync_status: {},
  sync_revisions: {},
  get_page_share: { path: "Notes/a.md" },
  set_page_share: { path: "Notes/a.md", enabled: false },
  list_drawing_shares: { path: "Drawings/a.excalidraw" },
  create_drawing_share: {
    path: "Drawings/a.excalidraw",
    access: "view",
    expiresIn: 3600,
  },
  revoke_drawing_share: { id: "share-id", path: "Drawings/a.excalidraw" },
  list_board_tasks: {},
  create_board_task: { title: "Demo task" },
  update_board_task: { id: "task-id", status: "done" },
  merge_text: { base: "base", local: "local", remote: "remote" },
};

describe("Evrenta MCP tools", () => {
  it("uses deployment-neutral names in agent-facing descriptions", () => {
    const { tools } = fixture();

    expect(tools.get("list_spaces")?.description).toContain(
      "List spaces this API token can access",
    );
    expect(tools.get("list_board_tasks")?.description).toContain(
      "task board linked to this space",
    );
    expect(tools.get("list_spaces")?.description).not.toContain("{{");
    expect(tools.get("list_board_tasks")?.description).not.toContain("{{");
  });

  it("registers Application content, search, revisions, sharing, and board tools", () => {
    const { tools } = fixture();
    for (const name of [
      "list_spaces",
      "whoami",
      "list_files",
      "read_file",
      "write_file",
      "delete_file",
      "search",
      "read_file_revision",
      "sync_revisions",
      "set_page_share",
      "create_drawing_share",
      "list_board_tasks",
      "create_board_task",
      "update_board_task",
    ]) {
      expect(tools.has(name), name).toBe(true);
    }
    expect(tools.size).toBeGreaterThanOrEqual(25);
  });

  it("provides Zod object schemas required by MCP SDK v2", () => {
    const { tools } = fixture();
    const schema = tools.get("write_file")?.inputSchema;
    expect(
      schema?.safeParse({ path: "Notes/a.md", content: "ok" }).success,
    ).toBe(true);
    expect(
      schema?.safeParse({ path: "Notes/a.md", content: "ok", extra: true })
        .success,
    ).toBe(false);
    expect(
      schema?.safeParse({
        path: "Notes/a.md",
        content: "ok",
        spaceId: "11111111-1111-4111-8111-111111111111",
      }).success,
    ).toBe(true);
  });

  it("discovers spaces and scopes tools to the selected space", async () => {
    const spaces = vi.fn(async () => [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Notes",
        permissions: ["content.read"],
      },
    ]);
    const json = vi.fn(async () => [{ name: "Plan.md" }]);
    const { tools, client } = fixture({ spaces, json });
    const listed = await tools.get("list_spaces")?.handler({});
    expect(JSON.parse(listed?.content[0]?.text ?? "{}")).toEqual([
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Notes",
        permissions: ["content.read"],
      },
    ]);
    await tools.get("list_files")?.handler({
      spaceId: "11111111-1111-4111-8111-111111111111",
    });
    expect(client.inSpace).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      expect.any(Function),
    );
    expect(json).toHaveBeenCalledWith("/api/files");
  });

  it("reports current actor and safe Application space metadata", async () => {
    const json = vi.fn(async (path: string) =>
      path === "/api/accounts"
        ? [{ username: "ada", fullName: "Ada", me: true }]
        : {
            spaceId: "space-id",
            spaceName: "Notes",
            indexPage: "Home",
            readOnly: false,
            revisions: "managed",
            boardUrl: "/api/board/open",
            spaceFolderPath: "/secret/server/path",
            permissions: ["content.read", "search.query"],
          },
    );
    const { tools } = fixture({ json });
    const result = await tools.get("whoami")?.handler({});
    expect(result?.isError).toBe(false);
    const value = JSON.parse(result?.content[0]?.text ?? "{}");
    expect(value.user).toMatchObject({ username: "ada", me: true });
    expect(value.space).toMatchObject({
      id: "space-id",
      name: "Notes",
      boardAvailable: true,
    });
    expect(JSON.stringify(value)).not.toContain("/secret/server/path");
  });

  it("writes with optimistic concurrency and disallows simultaneous createOnly", async () => {
    const text = vi.fn(async () => ({
      text: "OK",
      headers: new Headers({ "x-app-revision": '"sha256:abc"' }),
    }));
    const { tools, client } = fixture({ text });
    const result = await tools.get("write_file")?.handler({
      path: "Notes/Plan.md",
      content: "hello",
      ifMatch: `"sha256:${"a".repeat(64)}"`,
    });
    expect(result?.isError).toBe(false);
    expect(text).toHaveBeenCalledWith(
      "/api/files/Notes/Plan.md",
      expect.objectContaining({ method: "PUT", body: "hello" }),
    );
    const firstCall = text.mock.calls[0];
    if (!firstCall) throw new Error("write_file did not call the API client");
    const headers = new Headers((firstCall[1] as RequestInit).headers);
    expect(headers.get("if-match")).toBe(`"sha256:${"a".repeat(64)}"`);

    const conflict = await tools.get("write_file")?.handler({
      path: "Notes/new.md",
      content: "hello",
      createOnly: true,
      ifMatch: `"sha256:${"a".repeat(64)}"`,
    });
    expect(conflict?.isError).toBe(true);
    expect(client.text).toHaveBeenCalledTimes(1);
  });

  it("chooses a safe text content type and scopes conditional file mutations", async () => {
    const text = vi.fn(async () => ({ text: "OK", headers: new Headers() }));
    const { tools } = fixture({ text });

    await tools.get("write_file")?.handler({
      path: "Notes/readme.txt",
      content: "plain text",
    });
    const [, writeInit] = text.mock.calls[0] ?? [];
    expect(
      new Headers((writeInit as RequestInit).headers).get("content-type"),
    ).toBe("text/plain; charset=utf-8");

    await tools.get("write_file")?.handler({
      path: "Notes/new.txt",
      content: "markdown override",
      contentType: "text/markdown",
      createOnly: true,
    });
    const [, createInit] = text.mock.calls[1] ?? [];
    const createHeaders = new Headers((createInit as RequestInit).headers);
    expect(createHeaders.get("content-type")).toBe("text/markdown");
    expect(createHeaders.get("if-none-match")).toBe("*");

    await tools.get("delete_file")?.handler({ path: "Notes/old.txt" });
    await tools.get("delete_file")?.handler({
      path: "Notes/changed.txt",
      ifMatch: `"sha256:${"a".repeat(64)}"`,
    });
    expect(text).toHaveBeenCalledTimes(4);
    const deleteInit = text.mock.calls[3]?.[1];
    expect(deleteInit).toBeDefined();
    expect(
      new Headers((deleteInit as RequestInit).headers).get("if-match"),
    ).toBe(`"sha256:${"a".repeat(64)}"`);
  });

  it("reconciles from hashed base content through Application's merge-safe file contract", async () => {
    const json = vi.fn().mockResolvedValue({ status: "applied" });
    const { tools } = fixture({ json });
    const result = await tools.get("reconcile_file")?.handler({
      path: "Notes/Plan.md",
      baseText: "old",
      proposedText: "new",
    });
    expect(result?.isError).toBe(false);
    const [path, init] = json.mock.calls[0] ?? [];
    expect(path).toBe("/api/files/Notes/Plan.md");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      baseHash: createHash("sha256").update("old", "utf8").digest("hex"),
      baseText: "old",
      proposedHash: createHash("sha256").update("new", "utf8").digest("hex"),
      proposedText: "new",
    });
  });

  it("rejects unsafe file paths before making an API call", async () => {
    const json = vi.fn();
    const { tools } = fixture({ json });
    const result = await tools
      .get("read_file")
      ?.handler({ path: "../private.md" });
    expect(result?.isError).toBe(true);
    expect(json).not.toHaveBeenCalled();
  });

  it("encodes search and Board list arguments against the Application contract", async () => {
    const json = vi.fn().mockResolvedValue({ items: [] });
    const { tools } = fixture({ json });
    await tools
      .get("search")
      ?.handler({ query: "release plan", scope: "pages", limit: 5 });
    await tools.get("list_board_tasks")?.handler({ page: 2, limit: 25 });
    expect(json).toHaveBeenNthCalledWith(
      1,
      "/api/search/query",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          query: "release plan",
          scope: "pages",
          limit: 5,
        }),
      }),
    );
    expect(json).toHaveBeenNthCalledWith(2, "/api/board/tasks?page=2&limit=25");
  });

  it("updates Board tasks through the space API and rejects empty updates", async () => {
    const json = vi.fn().mockResolvedValue({ id: "task/1", status: "done" });
    const { tools, client } = fixture({ json });
    const result = await tools.get("update_board_task")?.handler({
      id: "task/1",
      status: "done",
      description: "Completed",
      assigneeId: null,
      dueDate: null,
    });
    expect(result?.isError).toBe(false);
    expect(json).toHaveBeenCalledWith("/api/board/tasks/task%2F1", {
      method: "PUT",
      body: JSON.stringify({
        status: "done",
        description: "Completed",
        assigneeId: null,
        dueDate: null,
      }),
    });
    expect(client.inSpace).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      expect.any(Function),
    );

    const invalid = await tools
      .get("update_board_task")
      ?.handler({ id: "task-1" });
    expect(invalid?.isError).toBe(true);
    expect(json).toHaveBeenCalledTimes(1);
  });

  it("runs every registered tool with validated arguments", async () => {
    const json = vi.fn(async (path: string) =>
      path === "/api/accounts" ? [] : {},
    );
    const head = vi.fn(async () => new Headers());
    const bytes = vi.fn(async () => ({
      bytes: new Uint8Array(),
      contentType: "text/plain",
      headers: new Headers(),
    }));
    const text = vi.fn(async () => ({ text: "", headers: new Headers() }));
    const { tools, client } = fixture({ json, head, bytes, text });
    expect(Object.keys(validToolArgs).sort()).toEqual([...tools.keys()].sort());
    for (const [name, value] of Object.entries(validToolArgs)) {
      const tool = tools.get(name);
      if (!tool) throw new Error(`Missing MCP tool: ${name}`);
      const result = await tool.handler(tool.inputSchema.parse(value));
      expect(result.isError, name).not.toBe(true);
    }
    expect(client.inSpace).toHaveBeenCalledTimes(tools.size - 1);
    expect(json).toHaveBeenCalled();
    expect(head).toHaveBeenCalled();
    expect(bytes).toHaveBeenCalled();
    expect(text).toHaveBeenCalled();
  });

  it("routes every registered tool through the bearer-authenticated origin client", async () => {
    const spaceId = "22222222-2222-4222-8222-222222222222";
    const calls: Array<{ path: string; method: string }> = [];
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        expect(url.origin).toBe("https://app.example.test");
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer scoped-test-token",
        );
        calls.push({ path: url.pathname, method });

        if (url.pathname === "/api/mcp/spaces") {
          return Response.json({
            data: {
              spaces: [
                { id: spaceId, name: "Plans", permissions: ["content.read"] },
              ],
            },
          });
        }
        expect(url.pathname.startsWith(`/api/mcp/spaces/${spaceId}/api/`)).toBe(
          true,
        );
        if (url.pathname.endsWith("/api/accounts")) {
          return Response.json({ data: [{ username: "ada", me: true }] });
        }
        if (url.pathname.endsWith("/api/config")) {
          return Response.json({
            data: {
              spaceId,
              spaceName: "Plans",
              indexPage: "Home",
              readOnly: false,
              revisions: "managed",
            },
          });
        }
        if (method === "HEAD") {
          return new Response(null, {
            headers: {
              "content-type": "text/markdown; charset=utf-8",
              "content-length": "12",
              "x-app-revision": `"sha256:${"b".repeat(64)}"`,
            },
          });
        }
        if (
          url.pathname.endsWith("/api/files/Notes/a.md") &&
          method === "GET"
        ) {
          return new Response("fixture text", {
            headers: { "content-type": "text/markdown; charset=utf-8" },
          });
        }
        return Response.json({ data: { ok: true } });
      },
    );
    vi.stubGlobal("fetch", fetch);

    const tools = new Map<string, RegisteredTool>();
    const server = {
      registerTool: vi.fn((name, config, handler) => {
        tools.set(name, {
          description: config.description,
          inputSchema: config.inputSchema,
          handler,
        });
      }),
    };
    registerTools(
      server as never,
      new ApplicationClient("https://app.example.test", "scoped-test-token"),
    );
    expect(Object.keys(validToolArgs).sort()).toEqual([...tools.keys()].sort());

    for (const [name, args] of Object.entries(validToolArgs)) {
      const tool = tools.get(name);
      if (!tool) throw new Error(`Missing MCP tool: ${name}`);
      const input = name === "list_spaces" ? args : { ...args, spaceId };
      const result = await tool.handler(tool.inputSchema.parse(input));
      expect(result.isError, name).not.toBe(true);
    }

    expect(calls.map((call) => call.method)).toEqual(
      expect.arrayContaining(["GET", "HEAD", "POST", "PUT", "DELETE"]),
    );
    expect(
      calls.filter((call) => call.path === "/api/mcp/spaces"),
    ).toHaveLength(1);
    expect(calls.length).toBeGreaterThan(30);
  });

  it("returns binary file content losslessly as base64", async () => {
    const bytes = vi.fn().mockResolvedValue({
      bytes: new Uint8Array([0, 255, 1]),
      contentType: "image/png",
      headers: new Headers(),
    });
    const { tools } = fixture({ bytes });
    const result = await tools
      .get("read_file")
      ?.handler({ path: "Drawings/image.png" });
    expect(JSON.parse(result?.content[0]?.text ?? "{}")).toMatchObject({
      encoding: "base64",
      content: "AP8B",
    });
  });

  it("preserves invalid UTF-8 bytes even when the server labels them as text", async () => {
    const bytes = vi.fn().mockResolvedValue({
      bytes: new Uint8Array([0xff, 0xfe]),
      contentType: "text/plain",
      headers: new Headers(),
    });
    const { tools } = fixture({ bytes });
    const result = await tools.get("read_file")?.handler({
      path: "Notes/invalid.txt",
    });

    expect(JSON.parse(result?.content[0]?.text ?? "{}")).toMatchObject({
      encoding: "base64",
      content: "//4=",
    });
  });

  it("returns a decoded diff for a requested Git revision", async () => {
    const bytes = vi.fn().mockResolvedValue({
      bytes: new TextEncoder().encode("-old\n+new\n"),
      contentType: "text/plain",
      headers: new Headers(),
    });
    const { tools } = fixture({ bytes });
    const result = await tools.get("read_file_revision")?.handler({
      path: "Notes/Plan.md",
      revision: "a".repeat(40),
      diff: true,
      maxBytes: 1024,
    });

    expect(JSON.parse(result?.content[0]?.text ?? "{}")).toMatchObject({
      diff: "-old\n+new\n",
    });
    expect(bytes).toHaveBeenCalledWith(
      `/api/revisions/Notes/Plan.md?rev=${"a".repeat(40)}&format=diff`,
      1024,
    );
  });

  it("surfaces API errors as MCP tool errors", async () => {
    const json = vi
      .fn()
      .mockRejectedValue(new Error("/api/search/status: forbidden"));
    const { tools } = fixture({ json });
    const result = await tools.get("get_search_status")?.handler({});
    expect(result?.isError).toBe(true);
    expect(result?.content[0]?.text).toContain("forbidden");
  });
});
