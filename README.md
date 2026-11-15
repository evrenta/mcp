# Evrenta MCP server

`@evrenta/mcp` is a lightweight stdio MCP server for Evrenta Notes. Configure only the
Notes origin and a scoped **agent token**. The MCP discovers the spaces the token can
access, then routes each request through the Notes service's normal
per-space authorization. Boards task tools use the notes service's
`/api/board/tasks` bridge and the same agent token; they do not require separate
Boards sign-in or a second token.

## Create an agent token

In Evrenta Notes, open **Profile → API tokens → New token**. Choose **Agent — AI and
automation**, select the notes space(s), grant only the needed permissions,
and set an expiry. Copy the token when Notes shows it; it cannot be viewed
again. For normal page work, grant `content.read`, `content.write`,
`content.delete`, and `search.query`. Add `revisions.read` / `revisions.manage`
for revision tools, `content.read` plus `content.share` for page sharing,
`drawings.read`,
`drawings.write`, and `drawings.share` for drawing tools. Grant `board.read` to
list board tasks and `board.manage` to create and update tasks; these Board
permissions can be scoped independently. The notes service enforces the token,
account, and space permissions on every request.

## Configure an MCP client

Run the package with Node.js 24+ and provide the token through your MCP
client's secret/environment-variable facility. Do not commit the token to a
project config or paste it into prompts.

```json
{
  "mcpServers": {
      "application": {
      "command": "npx",
      "args": ["-y", "@evrenta/mcp"],
      "env": {
        "APP_API_URL": "https://notes.example.com",
        "APP_API_TOKEN": "<secret-from-your-secret-manager>",
        "APP_BRAND_NAME": "Evrenta Notes",
        "BOARD_BRAND_NAME": "Evrenta Boards"
      }
    }
  }
}
```

`APP_API_URL` is the notes service origin, such as `https://notes.example.com`.
`APP_BRAND_NAME` and `BOARD_BRAND_NAME` are optional and customize the product names
shown in tool descriptions; set them to the same values used by your instance.
Space paths are discovered from the token and must not be included. `/api` may
be included or omitted. It defaults to `http://localhost:3000`; non-loopback
URLs must use HTTPS. Call `list_spaces` to inspect accessible spaces and their
effective permissions. If the token can access exactly one space, tools select
it automatically. If it can access more than one, pass that space's `spaceId`
to a tool. To run from a source checkout:

```sh
cd mcp
npm install
npm run build
APP_API_URL=https://notes.example.com \
  APP_API_TOKEN='…' node dist/index.js
```

## Tools

- Identity and discovery: `list_spaces`, `whoami`, `list_files`, `get_file_metadata`,
  `lookup_page`, `get_page`.
- Content: `read_file`, `write_file`, `delete_file`. File reads are bounded;
  binary file data is base64 encoded. Writes accept `ifMatch` or `createOnly`
  for safe optimistic concurrency. `reconcile_file` applies edits against an
  exact base and lets the notes service merge concurrent changes.
- Search: `get_search_status`, `search`.
- Revisions: `list_file_revisions`, `read_file_revision`,
  `get_document_history`, `read_document_version`, `checkpoint_document`,
  `list_revision_history`, `delete_document_version`, `get_revision_log`,
  `create_revision_snapshot`,
  `get_revision_activity`, `get_revision_sync_status`, `sync_revisions`.
- Page identity: `move_page_identity` updates a stable page ID after the file
  has already been moved.
- Sharing: `get_page_share`, `set_page_share`, `list_drawing_shares`,
  `create_drawing_share`, `revoke_drawing_share`.
- Boards bridge: `list_board_tasks`, `create_board_task`,
  `update_board_task`. The wider standalone Board project-management API is
  intentionally not called with the notes service token.
- Utilities: `merge_text` (pure three-way merge; does not write files).

Tools make direct API calls; the notes service remains the authority for access checks.
Some tools intentionally mutate or delete content, revisions, or shares. Review
their descriptions and grant the matching least-privilege token permissions.
The MCP process stores no credentials on disk, follows no redirects, limits
response sizes, and applies request timeouts.

Long-lived SSE events and collaboration WebSockets are streams rather than
request/response tools and are not exposed. The generic `/api/proxy` endpoint is
also intentionally excluded. Board task tools cover only the listing and
creation operations currently exposed by the notes service API contract.

## Development and verification

```sh
cd mcp
npm run typecheck
npm test
npm run build
```

## Release

This package is maintained in the standalone [Evrenta/mcp](https://github.com/Evrenta/mcp)
repository. For an unpublished package, add a narrowly scoped npm publish token as
the GitHub Actions secret `NPM_TOKEN` to bootstrap the first release. After the
package exists on npm, configure its trusted publisher for GitHub Actions with
organization `Evrenta`, repository `mcp`, and workflow `publish.yml`. The workflow
then uses short-lived OIDC credentials; remove `NPM_TOKEN` after confirming a
trusted publish succeeds.

For a release, update the version in `package.json`, `package-lock.json`, and
`server.json` to the same value, then push a matching `v<version>` tag (for example,
`v0.3.0`). The workflow validates the tag, installs the locked dependencies, runs
type checking and tests, builds the package, and publishes it to npm with provenance.
