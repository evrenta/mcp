import { createHash } from "node:crypto";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ApplicationClient } from "./client.js";
import { errorResult, textResult } from "./result.js";
import {
  fileApiPath,
  queryString,
  revisionApiPath,
  textContentType,
  validateSpacePath,
} from "./utils.js";

export type ToolRegistrar = {
  registerTool<S extends z.ZodObject>(
    name: string,
    config: { description: string; inputSchema: S },
    callback: (args: z.output<S>) => Promise<CallToolResult>,
  ): unknown;
};

const text = z.string().trim().min(1);
const revision = z.string().regex(/^(?:[\da-f]{40}|"sha256:[\da-f]{64}")$/i);
const page = z.string().min(2).max(4096);
const limit = z.number().int().min(1).max(200);

function json(method: string, value?: unknown): RequestInit {
  return {
    method,
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  };
}

function pathOf(path: string): string {
  return fileApiPath(validateSpacePath(path));
}

function revisionOf(path: string): string {
  return revisionApiPath(validateSpacePath(path));
}

function content(
  bytes: Uint8Array,
  contentType: string,
): {
  encoding: "utf-8" | "base64";
  content: string;
} {
  if (textContentType(contentType)) {
    try {
      return {
        encoding: "utf-8",
        content: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      };
    } catch {
      // Some extensions are served with an incorrect content type; preserve the bytes.
    }
  }
  return { encoding: "base64", content: Buffer.from(bytes).toString("base64") };
}

export function registerTools(
  server: ToolRegistrar,
  client: ApplicationClient,
): void {
  const add = <S extends z.ZodObject>(
    name: string,
    description: string,
    schema: S,
    handler: (args: z.output<S>) => Promise<unknown>,
    spaceScoped = true,
  ) => {
    const inputSchema = spaceScoped
      ? z
          .object({
            ...schema.shape,
            spaceId: z
              .string()
              .uuid()
              .optional()
              .describe(
                "Space ID from list_spaces; omit when only one is accessible",
              ),
          })
          .strict()
      : schema;
    server.registerTool(
      name,
      {
        description: spaceScoped
          ? `${description} If the token can access multiple spaces, call list_spaces and pass the selected spaceId.`
          : description,
        inputSchema,
      },
      async (rawArgs) => {
        try {
          if (!spaceScoped) {
            return textResult(await handler(rawArgs as z.output<S>));
          }
          const { spaceId, ...args } = rawArgs as z.output<S> & {
            spaceId?: string;
          };
          const selectedSpace = await client.resolveSpace(spaceId);
          return textResult(
            await client.inSpace(selectedSpace, () =>
              handler(args as z.output<S>),
            ),
          );
        } catch (error) {
          return errorResult(error);
        }
      },
    );
  };

  add(
    "list_spaces",
    "List spaces this API token can access, with its effective permissions in each space.",
    z.object({}).strict(),
    () => client.spaces(),
    false,
  );

  add(
    "whoami",
    "Return the authenticated account, this space's safe metadata, and the token's effective permissions.",
    z.object({}).strict(),
    async () => {
      const [accounts, config] = await Promise.all([
        client.json<
          Array<{ me?: boolean; username?: string; fullName?: string }>
        >("/api/accounts"),
        client.json<Record<string, unknown>>("/api/config"),
      ]);
      return {
        user: accounts.find((account) => account.me) ?? null,
        space: {
          id: config.spaceId,
          name: config.spaceName,
          indexPage: config.indexPage,
          readOnly: config.readOnly,
          revisions: config.revisions,
          boardAvailable: Boolean(config.boardUrl),
        },
        permissions: config.permissions ?? [],
      };
    },
  );

  add(
    "list_files",
    "List visible files in the current space with content type, size, and permissions.",
    z.object({}).strict(),
    () => client.json("/api/files"),
  );

  add(
    "get_file_metadata",
    "Read metadata and the current content revision for a file without downloading its contents.",
    z.object({ path: text }),
    async ({ path }) => {
      const headers = await client.head(pathOf(path));
      return {
        path,
        contentType:
          headers.get("x-content-type") ?? headers.get("content-type"),
        size: Number(
          headers.get("x-content-length") ?? headers.get("content-length"),
        ),
        permission: headers.get("x-permission"),
        created: Number(headers.get("x-created")),
        lastModified: Number(headers.get("x-last-modified")),
        revision: headers.get("x-app-revision") ?? headers.get("etag"),
      };
    },
  );

  add(
    "read_file",
    "Read a file. Text is returned as UTF-8; binary files are returned as base64. Reads are bounded to 2 MiB per call.",
    z
      .object({
        path: text,
        maxBytes: z
          .number()
          .int()
          .min(1)
          .max(2 * 1024 * 1024)
          .default(256 * 1024),
      })
      .strict(),
    async ({ path, maxBytes }) => {
      const result = await client.bytes(pathOf(path), maxBytes);
      return {
        path,
        contentType: result.contentType,
        revision:
          result.headers.get("x-app-revision") ?? result.headers.get("etag"),
        ...content(result.bytes, result.contentType),
      };
    },
  );

  add(
    "write_file",
    "Create or replace a UTF-8 file. Use revision from read_file/get_file_metadata as ifMatch to prevent overwriting concurrent edits; set createOnly for a new file.",
    z
      .object({
        path: text,
        content: z.string().max(1_000_000),
        contentType: z.string().max(128).optional(),
        ifMatch: revision.optional(),
        createOnly: z.boolean().default(false),
      })
      .strict(),
    async ({ path, content: value, contentType, ifMatch, createOnly }) => {
      if (ifMatch && createOnly)
        throw new Error("ifMatch and createOnly cannot be used together");
      const headers = new Headers({
        "Content-Type":
          contentType ??
          (path.endsWith(".md")
            ? "text/markdown; charset=utf-8"
            : "text/plain; charset=utf-8"),
      });
      if (ifMatch) headers.set("If-Match", ifMatch);
      if (createOnly) headers.set("If-None-Match", "*");
      const result = await client.text(pathOf(path), {
        method: "PUT",
        headers,
        body: value,
      });
      return {
        path,
        status: "saved",
        revision:
          result.headers.get("x-app-revision") ?? result.headers.get("etag"),
      };
    },
  );

  add(
    "reconcile_file",
    "Apply a UTF-8 edit against the exact base text. The service merges concurrent edits and returns applied, merged, conflicted, or retry; inspect returned text before another write. This is safer than overwriting when another client may be editing.",
    z
      .object({
        path: text,
        baseText: z.string().max(1_000_000),
        proposedText: z.string().max(1_000_000),
      })
      .strict(),
    ({ path, baseText, proposedText }) => {
      const hash = (value: string) =>
        createHash("sha256").update(value, "utf8").digest("hex");
      return client.json(pathOf(path), {
        ...json("POST", {
          baseHash: hash(baseText),
          baseText,
          proposedHash: hash(proposedText),
          proposedText,
        }),
      });
    },
  );

  add(
    "delete_file",
    "Permanently delete a file. Pass ifMatch from its current metadata to avoid deleting a concurrently changed file.",
    z.object({ path: text, ifMatch: revision.optional() }).strict(),
    async ({ path, ifMatch }) => {
      const headers = new Headers();
      if (ifMatch) headers.set("If-Match", ifMatch);
      await client.text(pathOf(path), { method: "DELETE", headers });
      return { path, status: "deleted" };
    },
  );

  add(
    "lookup_page",
    "Resolve a Markdown page path to its stable page ID.",
    z.object({ path: text }).strict(),
    ({ path }) =>
      client.json(`/api/pages/lookup?${new URLSearchParams({ path })}`),
  );

  add(
    "get_page",
    "Resolve a stable page ID to its current path.",
    z.object({ id: text }).strict(),
    ({ id }) => client.json(`/api/pages/${encodeURIComponent(id)}`),
  );

  add(
    "move_page_identity",
    "Update a page's stable identity after its Markdown file has already been moved. The destination file must exist. Pass the id/from path from lookup_page; this tool does not move file contents.",
    z
      .object({
        id: text,
        from: text,
        to: text,
      })
      .strict(),
    (args) =>
      client.json(
        "/api/pages/move",
        json("POST", {
          id: args.id,
          from: validateSpacePath(args.from),
          to: validateSpacePath(args.to),
        }),
      ),
  );

  add(
    "get_search_status",
    "Check whether the search index is ready and which query modes are available.",
    z.object({}).strict(),
    () => client.json("/api/search/status"),
  );

  add(
    "search",
    "Search pages and metadata in this space. Results include page, line, excerpt, and match highlights.",
    z
      .object({
        query: page,
        mode: z.enum(["words", "phrase"]).optional(),
        scope: z.enum(["pages", "meta", "all"]).optional(),
        include: z.array(text.max(1024)).max(100).optional(),
        exclude: z.array(text.max(1024)).max(100).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      })
      .strict(),
    (args) => client.json("/api/search/query", json("POST", args)),
  );

  add(
    "list_file_revisions",
    "List a file's managed Git revisions. `before` is a revision cursor; limit is clamped to 200.",
    z
      .object({
        path: text,
        before: z
          .string()
          .regex(/^[\da-f]{40}$/i)
          .optional(),
        limit: limit.optional(),
      })
      .strict(),
    ({ path, before, limit: count }) =>
      client.json(
        `${revisionOf(path)}${queryString({ before, limit: count })}`,
      ),
  );

  add(
    "read_file_revision",
    "Read a previous file revision, or its diff from the parent revision.",
    z
      .object({
        path: text,
        revision: z.string().regex(/^[\da-f]{40}$/i),
        diff: z.boolean().default(false),
        maxBytes: z
          .number()
          .int()
          .min(1)
          .max(2 * 1024 * 1024)
          .default(256 * 1024),
      })
      .strict(),
    async ({ path, revision: rev, diff, maxBytes }) => {
      const result = await client.bytes(
        `${revisionOf(path)}${queryString({ rev, ...(diff ? { format: "diff" } : {}) })}`,
        maxBytes,
      );
      return {
        path,
        revision: rev,
        ...(diff
          ? { diff: new TextDecoder().decode(result.bytes) }
          : content(result.bytes, result.contentType)),
      };
    },
  );

  add(
    "get_document_history",
    "List immutable content snapshots for a Markdown document.",
    z.object({ path: text }).strict(),
    ({ path }) =>
      client.json(
        `/api/revisions/documents/${validateSpacePath(path).split("/").map(encodeURIComponent).join("/")}`,
      ),
  );

  add(
    "read_document_version",
    "Read a stored immutable document version by its snapshot revision.",
    z
      .object({
        path: text,
        revision: z.string().min(1).max(128),
        maxBytes: z
          .number()
          .int()
          .min(1)
          .max(2 * 1024 * 1024)
          .default(256 * 1024),
      })
      .strict(),
    async ({ path, revision: rev, maxBytes }) => {
      const versionPath = `/api/revisions/history/${validateSpacePath(path).split("/").map(encodeURIComponent).join("/")}${queryString({ rev })}`;
      const result = await client.bytes(versionPath, maxBytes);
      return {
        path,
        revision: rev,
        ...content(result.bytes, result.contentType),
      };
    },
  );

  add(
    "checkpoint_document",
    "Create a managed content snapshot for a document. Requires revisions.manage.",
    z.object({ path: text }).strict(),
    ({ path }) =>
      client.json(
        `/api/revisions/documents/${validateSpacePath(path).split("/").map(encodeURIComponent).join("/")}`,
        json("POST"),
      ),
  );

  add(
    "list_revision_history",
    "List the space's stored document history inventory and storage usage.",
    z.object({}).strict(),
    () => client.json("/api/revisions/history"),
  );

  add(
    "delete_document_version",
    "Permanently delete one stored document snapshot. Requires revisions.manage.",
    z.object({ path: text, revision: z.string().min(1).max(128) }).strict(),
    async ({ path, revision: rev }) => {
      await client.text(
        `/api/revisions/history/${validateSpacePath(path).split("/").map(encodeURIComponent).join("/")}${queryString({ rev })}`,
        { method: "DELETE" },
      );
      return { path, revision: rev, status: "deleted" };
    },
  );

  add(
    "get_revision_log",
    "Read the managed space-wide Git history, optionally before a revision and filtered by text.",
    z
      .object({
        before: z
          .string()
          .regex(/^[\da-f]{40}$/i)
          .optional(),
        query: z.string().max(4096).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      })
      .strict(),
    ({ before, query, limit: count }) =>
      client.json(
        `/api/revisions/${queryString({ before, q: query, limit: count })}`,
      ),
  );

  add(
    "create_revision_snapshot",
    "Create a managed Git snapshot of the current space contents. Requires revisions.manage.",
    z.object({}).strict(),
    () => client.json("/api/revisions/", json("POST")),
  );

  add(
    "get_revision_activity",
    "Summarize recent managed revision activity by time and top edited files.",
    z
      .object({
        since: z.number().int().optional(),
        filesSince: z.number().int().optional(),
        top: z.number().int().min(1).max(50).optional(),
      })
      .strict(),
    ({ since, filesSince, top }) =>
      client.json(
        `/api/revisions/activity${queryString({ since, filesSince, top })}`,
      ),
  );

  add(
    "get_revision_sync_status",
    "Inspect API-driven repository folder sync without starting a job.",
    z.object({}).strict(),
    () => client.json("/api/revisions/sync"),
  );

  add(
    "sync_revisions",
    "Request an API-driven repository folder sync. The repository wins simultaneous edits. Requires revisions.manage and a configured connection.",
    z.object({}).strict(),
    () => client.json("/api/revisions/sync", json("POST")),
  );

  add(
    "get_page_share",
    "Check whether a Markdown page currently has a public share link.",
    z.object({ path: text }).strict(),
    ({ path }) =>
      client.json(`/api/pages/share?${new URLSearchParams({ path })}`),
  );

  add(
    "set_page_share",
    "Enable or disable a public share link for a Markdown page. Enabling sharing exposes the page to anyone with its link. Requires content.read and content.share.",
    z.object({ path: text, enabled: z.boolean() }).strict(),
    ({ path, enabled }) =>
      client.json("/api/pages/share", json("POST", { path, enabled })),
  );

  add(
    "list_drawing_shares",
    "List existing share links for a drawing. Requires drawing write access.",
    z.object({ path: text }).strict(),
    ({ path }) =>
      client.json(`/api/draw/shares?${new URLSearchParams({ path })}`),
  );

  add(
    "create_drawing_share",
    "Create a time-limited view/edit share for a drawing. The returned bearer link grants access until expiry; treat it as a secret. Requires drawing share permission.",
    z
      .object({
        path: text,
        access: z.enum(["view", "edit"]),
        expiresIn: z
          .number()
          .int()
          .min(60)
          .max(30 * 24 * 60 * 60),
      })
      .strict(),
    (args) => client.json("/api/draw/shares", json("POST", args)),
  );

  add(
    "revoke_drawing_share",
    "Revoke a drawing share by ID. Requires drawing share permission.",
    z.object({ id: text, path: text }).strict(),
    async ({ id, path }) => {
      await client.text(
        `/api/draw/shares/${encodeURIComponent(id)}?${new URLSearchParams({ path })}`,
        { method: "DELETE" },
      );
      return { id, path, status: "revoked" };
    },
  );

  add(
    "list_board_tasks",
    "List tasks on the task board linked to this space (page 1–1,000,000; limit up to 100). Requires board.read.",
    z
      .object({
        page: z.number().int().min(1).max(1_000_000).default(1),
        limit: z.number().int().min(1).max(100).default(100),
      })
      .strict(),
    ({ page: pageNumber, limit: count }) =>
      client.json(
        `/api/board/tasks${queryString({ page: pageNumber, limit: count })}`,
      ),
  );

  add(
    "create_board_task",
    "Create a task on the task board linked to this space. Requires board.manage. The optional sourcePage is a path in this space.",
    z
      .object({
        title: text.max(500),
        description: z
          .string()
          .max(64 * 1024)
          .default(""),
        sourcePage: z.string().max(1024).optional(),
      })
      .strict(),
    (args) => client.json("/api/board/tasks", json("POST", args)),
  );

  add(
    "update_board_task",
    "Update a task on the task board linked to this space. Set one or more of status, description, assigneeId, or dueDate; use null to clear the assignee or due date. Requires board.manage.",
    z
      .object({
        id: text.max(128),
        status: z.string().max(128).optional(),
        description: z
          .string()
          .max(64 * 1024)
          .optional(),
        assigneeId: z.string().trim().min(1).max(128).nullable().optional(),
        dueDate: z.string().max(64).nullable().optional(),
      })
      .strict(),
    ({ id, ...updates }) => {
      if (!Object.values(updates).some((value) => value !== undefined))
        throw new Error("Provide at least one task field to update");
      return client.json(`/api/board/tasks/${encodeURIComponent(id)}`, {
        ...json("PUT", updates),
      });
    },
  );

  add(
    "merge_text",
    "Three-way merge text with conflict detection. This tool is pure computation and does not change files.",
    z
      .object({
        base: z.string().max(1_000_000),
        local: z.string().max(1_000_000),
        remote: z.string().max(1_000_000),
      })
      .strict(),
    (args) => client.json("/api/merges", json("POST", args)),
  );
}
