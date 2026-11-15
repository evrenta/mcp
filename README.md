# Evrenta MCP

[![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![MIT License](https://img.shields.io/badge/License-MIT-4051B5.svg)](LICENSE)
[![Model Context Protocol](https://img.shields.io/badge/Protocol-MCP-7158E2.svg)](https://modelcontextprotocol.io/)

**Connect your AI client to the Notes spaces and linked Boards tasks your agent token allows.**

Evrenta MCP runs on your machine and connects to your Notes service. Your token decides which spaces and actions are available, and Notes checks those permissions on every request.

[Quick start](#quick-start) · [Permissions](#permissions) · [Team use](#team-use) · [Troubleshooting](#troubleshooting) · [License](#license)

## Quick start

You’ll need an Evrenta Notes address, an MCP-compatible AI client, and Node.js 24 or later.

### 1. Create an agent token

In Notes, open **Profile → API tokens → New token**. Choose **Agent — AI and automation**, select the spaces to connect, set an expiry, and copy the token. Notes shows it only once.

Start with read access. You can add permissions later if your team wants the AI client to make changes.

### 2. Add the server to your AI client

Add this entry in the client’s MCP settings. Replace the example URL and token with your own. Keep the token in private client settings or a secret store; don’t commit it to a shared project.

```json
{
  "mcpServers": {
    "evrenta-notes": {
      "command": "npx",
      "args": ["-y", "@evrenta/mcp"],
      "env": {
        "APP_API_URL": "https://notes.example.com",
        "APP_API_TOKEN": "<your-agent-token>",
        "APP_BRAND_NAME": "Evrenta Notes",
        "BOARD_BRAND_NAME": "Evrenta Boards"
      }
    }
  }
}
```

Use your Notes service origin, without a space path. `/api` is optional. Hosted services must use HTTPS; plain HTTP is allowed for local development. The two brand variables are optional and only affect names shown in tool descriptions.

If npm can’t find `@evrenta/mcp` yet, run it from a source checkout:

```sh
git clone https://github.com/Evrenta/mcp.git
cd mcp
npm ci
npm run build
```

In your MCP settings, use `node` as the command and the full path to `mcp/dist/index.js` as its argument. Keep the same `env` values shown above.

### 3. Connect and try a search

Restart or reload the AI client, then ask it to call `list_spaces`. Try a read-only request, for example:

> Search our onboarding pages for the equipment return process and show me the most relevant page.

If the token can access one space, it is selected automatically. If it can access more than one, choose a `spaceId` from `list_spaces` for each space-specific request.

## Permissions

Grant only what each person needs. Permissions can differ by space.

| Team task | Permissions |
| --- | --- |
| Find and read pages | `content.read`, `search.query` |
| Create or edit pages | Add `content.write` |
| Delete pages or files | Add `content.delete` |
| Read revision history | Add `revisions.read` |
| Create or remove snapshots; sync a connected repository | Add `revisions.manage` |
| Share a page | Add `content.read` and `content.share` |
| Work with drawing shares | Add the required `drawings.read`, `drawings.write`, or `drawings.share` permissions |
| View tasks on linked Boards | Add `board.read` |
| Create or update linked tasks | Add `board.manage` |

## Team use

Give each teammate their own token rather than sharing one. This keeps access scoped to their account and spaces. Start with search and read access; add write or sharing permissions only when your team is ready.

Common ways to use the connection:

- **Find information:** Search Notes and ask for the page name along with the answer so a teammate can check the source.
- **Improve documentation:** Ask for a suggested edit first, then allow page updates when appropriate.
- **Track follow-ups:** List, create, and update tasks on Boards linked to the selected Notes space. These tools cover linked tasks, not the full Boards project-management API.
- **Review changes:** Inspect page history or create a snapshot before a larger edit.

The AI client shows each tool’s inputs and required permissions. Review proposed edits before applying them. Deletes are permanent; sharing a page or drawing can give others access through its link.

## Troubleshooting

| What you see | What to check |
| --- | --- |
| The MCP server doesn’t appear | Confirm Node.js 24+ is installed, then restart the client. |
| No spaces are listed | Check that the token is active and includes at least one space. |
| A tool says access is denied | Add the required permission to the token for that space. |
| A request needs a `spaceId` | Call `list_spaces`, choose the intended space, and pass its ID. |
| The service URL is rejected | Use the Notes origin, not a space URL; hosted services need HTTPS. |

## License

MIT © Stefan Kumarasinghe. See [LICENSE](LICENSE).
