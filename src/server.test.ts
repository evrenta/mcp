import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import {
  InMemoryTransport,
  LATEST_PROTOCOL_VERSION,
  type JSONRPCMessage,
} from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMcpServer } from "./server.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Evrenta MCP protocol server", () => {
  it("requires an API token before creating the MCP server", () => {
    vi.stubEnv("APP_API_TOKEN", "");
    expect(() => createMcpServer()).toThrow(/APP_API_TOKEN/);
  });

  it("uses the localhost origin when no API URL is configured", () => {
    const previousApiUrl = process.env.APP_API_URL;
    delete process.env.APP_API_URL;
    vi.stubEnv("APP_API_TOKEN", "test-token");

    try {
      expect(createMcpServer()).toBeDefined();
    } finally {
      if (previousApiUrl === undefined) {
        delete process.env.APP_API_URL;
      } else {
        process.env.APP_API_URL = previousApiUrl;
      }
    }
  });

  it("serves the registered tool catalog over the stdio transport", async () => {
    vi.stubEnv("APP_API_URL", "https://app.example.test");
    vi.stubEnv("APP_API_TOKEN", "stdio-test-token");
    const mcpServer = createMcpServer();
    const input = new PassThrough();
    const output = new PassThrough();
    const lines = createInterface({ input: output });
    const transport = new StdioServerTransport(input, output);
    const pending = new Map<
      number,
      (message: Record<string, unknown>) => void
    >();
    lines.on("line", (line) => {
      const message = JSON.parse(line) as Record<string, unknown>;
      if (typeof message.id === "number") pending.get(message.id)?.(message);
    });
    const request = (
      id: number,
      method: string,
      params?: Record<string, unknown>,
    ) => {
      const response = new Promise<Record<string, unknown>>(
        (resolve, reject) => {
          const timeout = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`Timed out waiting for stdio ${method}`));
          }, 2_000);
          pending.set(id, (message) => {
            clearTimeout(timeout);
            pending.delete(id);
            resolve(message);
          });
        },
      );
      input.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id,
          method,
          ...(params === undefined ? {} : { params }),
        })}\n`,
      );
      return response;
    };

    try {
      await mcpServer.connect(transport);
      const initialized = await request(1, "initialize", {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "evrenta-mcp-stdio-test", version: "1.0.0" },
      });
      expect(initialized.result).toMatchObject({
        serverInfo: { name: "evrenta-mcp" },
      });
      input.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        })}\n`,
      );
      const listed = await request(2, "tools/list", {});
      const result = listed.result as { tools?: Array<{ name: string }> };
      expect(result.tools?.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          "list_spaces",
          "read_file",
          "search",
          "list_board_tasks",
        ]),
      );
      expect(result.tools?.length).toBeGreaterThanOrEqual(30);
    } finally {
      await mcpServer.close();
      lines.close();
      input.destroy();
      output.destroy();
    }
  });

  it("lists tools and routes discovery and file calls over the MCP transport", async () => {
    const firstSpace = "11111111-1111-4111-8111-111111111111";
    const selectedSpace = "22222222-2222-4222-8222-222222222222";
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "https://app.example.test/api/mcp/spaces") {
          return Response.json({
            data: {
              spaces: [
                {
                  id: firstSpace,
                  name: "Notes",
                  permissions: ["content.read"],
                },
                {
                  id: selectedSpace,
                  name: "Plans",
                  permissions: ["content.read"],
                },
              ],
            },
          });
        }
        if (
          url ===
          `https://app.example.test/api/mcp/spaces/${selectedSpace}/api/files/Plan.md`
        ) {
          expect(new Headers(init?.headers).get("authorization")).toBe(
            "Bearer scoped-test-token",
          );
          expect(init?.redirect).toBe("error");
          return new Response("Launch plan", {
            headers: {
              "content-type": "text/markdown; charset=utf-8",
              "x-app-revision": `"sha256:${"a".repeat(64)}"`,
            },
          });
        }
        throw new Error(`Unexpected Application API request: ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetch);

    const mcpServer = createMcpServer({
      apiUrl: "https://app.example.test",
      token: "scoped-test-token",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const pending = new Map<number, (message: JSONRPCMessage) => void>();
    clientTransport.onmessage = (message) => {
      if ("id" in message && typeof message.id === "number") {
        pending.get(message.id)?.(message);
      }
    };

    const request = async (
      id: number,
      method: string,
      params?: Record<string, unknown>,
    ): Promise<JSONRPCMessage> => {
      const response = new Promise<JSONRPCMessage>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out waiting for MCP response to ${method}`));
        }, 2_000);
        pending.set(id, (message) => {
          clearTimeout(timeout);
          pending.delete(id);
          resolve(message);
        });
      });
      await clientTransport.send({
        jsonrpc: "2.0",
        id,
        method,
        ...(params === undefined ? {} : { params }),
      } as JSONRPCMessage);
      return response;
    };

    try {
      await mcpServer.connect(serverTransport);
      await clientTransport.start();
      const initialized = await request(1, "initialize", {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "evrenta-mcp-test", version: "1.0.0" },
      });
      expect(initialized).toMatchObject({
        id: 1,
        result: { serverInfo: { name: "evrenta-mcp" } },
      });
      await clientTransport.send({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      } as JSONRPCMessage);

      const listed = await request(2, "tools/list", {});
      const listedTools = (
        listed as { result?: { tools?: Array<{ name: string }> } }
      ).result?.tools;
      expect(listedTools?.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          "list_spaces",
          "read_file",
          "write_file",
          "search",
          "list_board_tasks",
          "create_board_task",
          "update_board_task",
        ]),
      );
      expect(listedTools?.length).toBeGreaterThanOrEqual(30);

      const spaces = await request(3, "tools/call", {
        name: "list_spaces",
        arguments: {},
      });
      const spacesResult = spaces as {
        result?: { content?: Array<{ type: string; text: string }> };
      };
      expect(
        JSON.parse(spacesResult.result?.content?.[0]?.text ?? "null"),
      ).toEqual([
        { id: firstSpace, name: "Notes", permissions: ["content.read"] },
        { id: selectedSpace, name: "Plans", permissions: ["content.read"] },
      ]);

      const file = await request(4, "tools/call", {
        name: "read_file",
        arguments: { path: "Plan.md", spaceId: selectedSpace },
      });
      const fileResult = file as {
        result?: { isError?: boolean; content?: Array<{ text: string }> };
      };
      expect(fileResult.result?.isError).not.toBe(true);
      expect(
        JSON.parse(fileResult.result?.content?.[0]?.text ?? "null"),
      ).toMatchObject({
        path: "Plan.md",
        encoding: "utf-8",
        content: "Launch plan",
      });
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      await mcpServer.close();
      await clientTransport.close();
    }
  });
});
