# Use Evrenta MCP with your team

Evrenta MCP connects an AI client to the Notes spaces your agent token can access. It can find and read pages, help update content, and work with tasks on the Boards linked to those spaces. Access always follows the token’s permissions.

## Get connected

You’ll need an Evrenta Notes address, an MCP-compatible AI client, and Node.js 24 or later.

### 1. Create an agent token

In Notes, open **Profile → API tokens → New token**. Choose **Agent — AI and automation**, select the spaces this connection needs, choose an expiry, and copy the token.

For a team, give each person their own token. This keeps access scoped and makes it clear whose permissions are being used. Start with read access; add write access only when the team is ready for the AI client to make changes.

| What you want to do | Permissions to grant |
| --- | --- |
| Find and read pages | `content.read`, `search.query` |
| Create or edit pages | Add `content.write` |
| Delete pages or files | Add `content.delete` |
| Read revision history | Add `revisions.read` |
| Create or remove revision snapshots, or sync a repository | Add `revisions.manage` |
| Share a page | Add `content.share` |
| Work with drawing shares | Add the needed `drawings.read`, `drawings.write`, or `drawings.share` permissions |
| View linked Boards tasks | Add `board.read` |
| Create or update linked Boards tasks | Add `board.manage` |

The token can have different permissions in different spaces. Only select the spaces the person or team needs.

### 2. Add Evrenta MCP to your AI client

Add this server entry in the client’s MCP settings. Put the token in the client’s private settings or secret store. Don’t commit a config containing the token to a shared repository.

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

Replace the example URL with your Notes address. Use the service origin only, without a space path; `/api` is optional. Hosted services must use HTTPS. `APP_BRAND_NAME` and `BOARD_BRAND_NAME` are optional and only change the names shown in tool descriptions.

If the package is not available from npm yet, clone this repository, run `npm ci` and `npm run build`, then set the client command to `node` and its argument to the full path to `dist/index.js` in your checkout.

### 3. Connect and try it

Restart or reload the AI client. Ask it to call `list_spaces` first. Then try a small read-only request, such as:

> Search our onboarding pages for the equipment return process and show me the most relevant page.

If the token can access one space, the server selects it automatically. If it can access several, choose the right space from `list_spaces` and pass its `spaceId` to the next tool call.

## How teams can use it

- **Find information:** Search Notes pages and ask for a short answer with the page name so teammates can check the source.
- **Draft or update content:** Ask for a proposed change first. Grant `content.write` when the team is ready to let the client apply edits.
- **Track follow-ups:** List, create, or update tasks on the Boards linked to the selected Notes space. These tools cover linked tasks; they aren’t the full Boards project-management API.
- **Review changes:** Use revision tools to inspect history or create a snapshot before a larger edit.

The server’s tool descriptions explain required inputs and permissions. Review changes before applying them. Delete actions are permanent, and sharing a page or drawing can give other people access through a link.

## If something doesn’t connect

- **The server doesn’t appear:** Check that Node.js 24 or later is installed, then restart the MCP client.
- **No spaces are listed:** Check that the token is active and was created for at least one space.
- **A tool reports access denied:** Ask the space owner to add the needed permission to your token.
- **Several spaces are listed:** Pass the intended `spaceId` with the tool call.
- **The URL is rejected:** Use the Notes origin, not a space URL. For a hosted service, use HTTPS.
