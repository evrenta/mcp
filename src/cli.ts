import { stdin } from "node:process";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createMcpServer } from "./server.js";

export async function runCli(): Promise<void> {
  const [command] = process.argv.slice(2);
  if (command && ["-h", "--help", "help"].includes(command)) {
    console.log(`evrenta-mcp — Model Context Protocol server (stdio)

Usage:
  evrenta-mcp          Start the MCP server
  evrenta-mcp serve    Start the MCP server
  evrenta-mcp --help   Show this help

Required environment:
  APP_API_TOKEN   Scoped service agent token
Optional environment:
  APP_API_URL     Service origin URL (default: http://localhost:3000)
`);
    return;
  }
  if (command && !["serve", "stdio", "run"].includes(command)) {
    console.error(`Unknown command: ${command}. Run evrenta-mcp --help.`);
    process.exitCode = 1;
    return;
  }
  if (stdin.isTTY && !command) {
    console.log(
      "evrenta-mcp is a stdio server. Configure it in your MCP client or run `evrenta-mcp serve`.",
    );
    return;
  }
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
}
