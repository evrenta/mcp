import type { CallToolResult } from "@modelcontextprotocol/server";

export function textResult(data: unknown, isError = false): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text:
          typeof data === "string"
            ? data
            : (JSON.stringify(data, null, 2) ?? ""),
      },
    ],
    isError,
  };
}

export function errorResult(error: unknown): CallToolResult {
  return textResult(
    { error: error instanceof Error ? error.message : String(error) },
    true,
  );
}
