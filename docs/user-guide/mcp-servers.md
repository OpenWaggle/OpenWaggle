# MCP Servers

OpenWaggle supports the [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) for connecting external tool servers. MCP servers extend the agent's capabilities beyond the built-in tools — for example, adding browser automation, database access, or custom API integrations.

## What Is MCP?

MCP is an open protocol that lets AI applications connect to external tool providers. An MCP server exposes tools (functions the agent can call), resources (data the agent can read), and prompts (templates the agent can use).

When you connect an MCP server, its tools appear alongside the built-in tools in the agent's toolkit. All MCP tools require approval before execution.

## Browsing Available MCPs

1. Click **MCPs** in the sidebar.
2. The panel shows two views:
   - **Available MCPs** — A registry of known MCP servers, including popular ones like Playwright (browser automation) and Chrome DevTools.
   - **Installed MCPs** — Servers you've added and their connection status.

## Adding an MCP Server

### From the Registry

1. Open the MCPs panel.
2. Find the server you want in the Available section.
3. Click **Install** — the add form opens pre-filled with the correct configuration.
4. Review the settings and click **Add**.

### Manual Configuration

1. Click **Add MCP** in the MCPs panel header.
2. Fill in the form:

   - **Name** — A display name for the server.
   - **Transport type** — How OpenWaggle communicates with the server:
     - **stdio** — Runs a local CLI process (most common). Requires a command and optional arguments.
     - **http** — Connects to an HTTP endpoint (StreamableHTTP protocol).
     - **sse** — Connects via Server-Sent Events (legacy MCP transport).

3. For **stdio** transport:
   - **Command** — The executable to run (e.g., `npx`, `node`, `python`).
   - **Arguments** — Command arguments, space-separated (e.g., `-y @anthropic/mcp-server-playwright`).

4. For **http** or **sse** transport:
   - **URL** — The server endpoint.

5. **Environment variables** (optional) — Key-value pairs passed to the server process. Use the + button to add entries. These can include API keys or configuration that the MCP server needs.

6. Click **Add** to connect.

## Managing MCP Servers

### Connection Status

Each installed server shows its status:
- **Connected** (green indicator) — Server is running and tools are available.
- **Disconnected** (gray indicator) — Server is not running or unreachable.

### Server Controls

- **Toggle** — Enable or disable a server without removing it.
- **Remove** — Delete the server configuration entirely.
- **Info** — View the server's capabilities (number of tools, resources, and prompts).

### Auto-Reconnect

If an stdio server process exits unexpectedly, OpenWaggle retries the connection up to 5 times with exponential backoff (1 second to 30 seconds between attempts).

## How MCP Tools Work in Practice

When the agent needs to use an MCP tool:

1. The tool appears in the approval banner with the tool name prefixed by the server name (e.g., `playwright__browser_navigate`).
2. You approve or deny the execution.
3. The result appears in the tool call block, just like built-in tools.

MCP tool calls have a 60-second timeout. If the server doesn't respond within that time, the call fails with a timeout error.

## Example: Adding Playwright for Browser Automation

1. Open MCPs panel.
2. Click **Add MCP**.
3. Configure:
   - Name: `Playwright`
   - Transport: `stdio`
   - Command: `npx`
   - Arguments: `-y @anthropic/mcp-server-playwright`
4. Click **Add**.

Once connected, the agent can navigate web pages, take screenshots, fill forms, and interact with browser content.

## Environment Variables for MCP Servers

MCP server processes receive a filtered environment by default (for security). Only safe variables like `PATH`, `HOME`, `SHELL`, `TERM`, `LANG`, `USER`, and `TMPDIR` are passed through.

To provide additional environment variables (e.g., API keys the server needs), add them in the **Environment Variables** section of the add/edit form.
