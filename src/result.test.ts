import { describe, expect, it } from "vitest";
import { errorResult, textResult } from "./result.js";

describe("MCP tool results", () => {
  it("returns text without JSON encoding and formats structured data", () => {
    expect(textResult("ready").content).toEqual([
      { type: "text", text: "ready" },
    ]);
    expect(textResult({ ready: true }).content).toEqual([
      { type: "text", text: '{\n  "ready": true\n}' },
    ]);
    expect(textResult(undefined).content).toEqual([{ type: "text", text: "" }]);
  });

  it("converts Error and non-Error failures into tool error results", () => {
    expect(errorResult(new Error("denied"))).toMatchObject({
      isError: true,
      content: [{ type: "text", text: '{\n  "error": "denied"\n}' }],
    });
    expect(errorResult("unavailable")).toMatchObject({
      isError: true,
      content: [{ type: "text", text: '{\n  "error": "unavailable"\n}' }],
    });
  });
});
