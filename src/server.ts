import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/server";
import { ApplicationClient } from "./client.js";
import { registerTools } from "./tools.js";
import { normalizeBaseUrl } from "./utils.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

export function createMcpServer(
  config: { apiUrl?: string; token?: string } = {},
): McpServer {
  const token = config.token ?? process.env.APP_API_TOKEN;
  if (!token?.trim()) {
    throw new Error("Set APP_API_TOKEN to a scoped notes service agent token");
  }
  const apiUrl = normalizeBaseUrl(
    config.apiUrl ?? process.env.APP_API_URL ?? "http://localhost:3000",
  );
  const server = new McpServer({ name: "evrenta-mcp", version });
  registerTools(server, new ApplicationClient(apiUrl, token.trim()));
  return server;
}
