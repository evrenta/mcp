import { stdin } from "node:process";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli } from "./cli.js";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  createMcpServer: vi.fn(),
}));

vi.mock("./server.js", () => ({ createMcpServer: mocks.createMcpServer }));

const originalArgv = [...process.argv];
const originalExitCode = process.exitCode;
const originalIsTTY = Object.getOwnPropertyDescriptor(stdin, "isTTY");

function setCommand(...args: string[]) {
  process.argv.splice(0, process.argv.length, "node", "evrenta-mcp", ...args);
}

function setIsTTY(value: boolean) {
  Object.defineProperty(stdin, "isTTY", { configurable: true, value });
}

afterEach(() => {
  process.argv.splice(0, process.argv.length, ...originalArgv);
  process.exitCode = originalExitCode;
  if (originalIsTTY) {
    Object.defineProperty(stdin, "isTTY", originalIsTTY);
  } else {
    Reflect.deleteProperty(stdin, "isTTY");
  }
  vi.restoreAllMocks();
});

beforeEach(() => {
  process.exitCode = undefined;
  setCommand();
  setIsTTY(false);
  mocks.connect.mockReset().mockResolvedValue(undefined);
  mocks.createMcpServer.mockReset().mockReturnValue({ connect: mocks.connect });
});

describe("Evrenta MCP command line", () => {
  it("prints help without starting a server", async () => {
    setCommand("--help");
    const output = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli();

    expect(output).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
    expect(mocks.createMcpServer).not.toHaveBeenCalled();
  });

  it("rejects unknown commands with a nonzero exit status", async () => {
    setCommand("remove-everything");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await runCli();

    expect(error).toHaveBeenCalledWith(
      "Unknown command: remove-everything. Run evrenta-mcp --help.",
    );
    expect(process.exitCode).toBe(1);
    expect(mocks.createMcpServer).not.toHaveBeenCalled();
  });

  it("prints a client hint instead of attaching stdio from an interactive terminal", async () => {
    setIsTTY(true);
    const output = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli();

    expect(output).toHaveBeenCalledWith(
      expect.stringContaining("Configure it in your MCP client"),
    );
    expect(mocks.createMcpServer).not.toHaveBeenCalled();
  });

  it("starts stdio for the default command and each supported alias", async () => {
    for (const command of [[], ["serve"], ["stdio"], ["run"]]) {
      setCommand(...command);
      await runCli();
    }

    expect(mocks.createMcpServer).toHaveBeenCalledTimes(4);
    expect(mocks.connect).toHaveBeenCalledTimes(4);
    for (const [transport] of mocks.connect.mock.calls) {
      expect(transport).toBeInstanceOf(StdioServerTransport);
    }
  });
});
