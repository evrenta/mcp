<p align="center">
  <img src="assets/mascot.knowledge.png" alt="Evrenta’s Knowledge mascot, a waving purple page with connected nodes" width="240" />
</p>

<h1 align="center">Evrenta MCP</h1>

<p align="center"><strong>Connect your AI client to the workspace spaces and linked task boards your agent token allows.</strong></p>

<p align="center">
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-24%2B-339933?logo=nodedotjs&logoColor=white" alt="Node.js 24 or later" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-4051B5.svg" alt="MIT License" /></a>
  <a href="https://modelcontextprotocol.io/"><img src="https://img.shields.io/badge/Protocol-MCP-7158E2.svg" alt="Model Context Protocol" /></a>
</p>

Evrenta MCP runs on your machine and connects to a compatible workspace service. The same package can connect to different instances; each client entry supplies that instance’s URL and agent token. The service checks token permissions on every request.

[Quick start](#quick-start) · [Permissions](#permissions) · [Team use](#team-use) · [Troubleshooting](#troubleshooting) · [License](#license)

## Quick start

You’ll need the URL of a compatible instance, an MCP-compatible AI client, and Node.js 24 or later.

### 1. Create an agent token

In the target instance, open **Profile → API tokens → New token**. Choose **Agent — AI and automation**, select the spaces to connect, set an expiry, and copy the token. The instance shows it only once.

Start with read access. You can add permissions later if your team wants the AI client to make changes.

### 2. Install the package (optional)

When the npm package is available, you can install it globally:

```sh
npm install -g @evrenta/mcp
```

The AI client configuration below uses `npx`, so a separate global install is optional.

### 3. Add the server to your AI client

Add this entry in the client’s MCP settings. Replace the example URL and token with your own. `workspace` is only a local name in the client; you can change it. Keep the token in private client settings or a secret store, and don’t commit it to a shared project.

```json
{
  "mcpServers": {
    "workspace": {
      "command": "npx",
      "args": ["-y", "@evrenta/mcp"],
      "env": {
        "APP_API_URL": "https://your-instance.example.com",
        "APP_API_TOKEN": "<your-agent-token>"
      }
    }
  }
}
```

Use the target instance’s service origin, without a space path. `/api` is optional. Hosted services must use HTTPS; plain HTTP is allowed for local development. Add another `mcpServers` entry with its own URL and token to connect to another instance.

If npm can’t find `@evrenta/mcp` yet, run it from a source checkout:

```sh
git clone https://github.com/Evrenta/mcp.git
cd mcp
npm ci
npm run build
```

In your MCP settings, use `node` as the command and the full path to `mcp/dist/index.js` as its argument. Keep only the `APP_API_URL` and `APP_API_TOKEN` values shown above.

### 4. Connect and try a search

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
| View tasks on a linked task board | Add `board.read` |
| Create or update linked tasks | Add `board.manage` |

## Team use

Give each teammate their own token rather than sharing one. This keeps access scoped to their account and spaces. Start with search and read access; add write or sharing permissions only when your team is ready.

Common ways to use the connection:

- **Find information:** Search workspace pages and ask for the page name along with the answer so a teammate can check the source.
- **Improve documentation:** Ask for a suggested edit first, then allow page updates when appropriate.
- **Track follow-ups:** List, create, and update tasks on the task board linked to the selected space. These tools cover linked tasks, not the full project-management API.
- **Review changes:** Inspect page history or create a snapshot before a larger edit.

The AI client shows each tool’s inputs and required permissions. Review proposed edits before applying them. Deletes are permanent; sharing a page or drawing can give others access through its link.

## Troubleshooting

| What you see | What to check |
| --- | --- |
| The MCP server doesn’t appear | Confirm Node.js 24+ is installed, then restart the client. |
| No spaces are listed | Check that the token is active and includes at least one space. |
| A tool says access is denied | Add the required permission to the token for that space. |
| A request needs a `spaceId` | Call `list_spaces`, choose the intended space, and pass its ID. |
| The service URL is rejected | Use the instance origin, not a space URL; hosted services need HTTPS. |

## License

MIT © Stefan Kumarasinghe. See [LICENSE](LICENSE).
