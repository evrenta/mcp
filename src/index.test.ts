import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runCli: vi.fn() }));

vi.mock("./cli.js", () => ({ runCli: mocks.runCli }));

const originalExitCode = process.exitCode;

afterEach(() => {
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("Application MCP executable entry point", () => {
  it("reports startup errors and sets a failing exit status", async () => {
    mocks.runCli.mockRejectedValueOnce(new Error("startup failed"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;

    await import("./index.js?entrypoint-error");
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith("startup failed"),
    );

    expect(process.exitCode).toBe(1);
  });

  it("reports non-Error startup failures without losing their value", async () => {
    mocks.runCli.mockRejectedValueOnce("startup failed");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;

    await import("./index.js?entrypoint-non-error");
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith("startup failed"),
    );

    expect(process.exitCode).toBe(1);
  });
});
