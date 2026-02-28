# 26 — MCP Support

**Status:** Done
**Priority:** P2
**Category:** Feature
**Depends on:** None
**Origin:** Spec 04

---

## Problem

OpenWaggle is a closed system. MCP (Model Context Protocol) is the emerging standard for connecting LLMs to external tools and resources. Without it, users can't connect to GitHub, Slack, databases, or any of the hundreds of existing MCP servers. Cursor, Claude Desktop, and GitHub Copilot all support it.

## What Exists Today

- Sidebar has a "MCPs" nav item that's disabled ("Coming soon")
- The tool system (`define-tool.ts`) creates `ServerTool` instances — MCP tools would need to produce the same type
- The feature registry supports dynamic tool injection via `AgentFeature.getTools()`

## Implementation — Phase 1 (stdio transport, ~500-800 LOC)

### 1. Config format

Create `src/shared/types/mcp.ts`:
```ts
interface McpServerConfig {
  id: string
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
  enabled: boolean
}
```
Store in settings: add `mcpServers: McpServerConfig[]` to `Settings`.

### 2. MCP Client

Create `src/main/mcp/client.ts`:
- Spawn child process with `command` + `args`
- Communicate over stdin/stdout using JSON-RPC (MCP protocol)
- Implement `initialize`, `tools/list`, `tools/call` methods
- Handle process lifecycle (start, restart on crash, graceful shutdown)

### 3. MCP Registry

Create `src/main/mcp/registry.ts`:
- Manage multiple MCP server connections
- On app startup, start all enabled servers
- Provide `getTools(): ServerTool[]` converting MCP tool definitions to TanStack AI format
- Handle server crashes with backoff retry

### 4. MCP Agent Feature

Create `src/main/agent/features/mcp-feature.ts`:
- Implements `AgentFeature` interface
- `getTools()` returns all active MCP tools from the registry
- Tools prefixed with server name: `mcp_github_create_issue`

### 5. Settings UI

Enable the MCPs sidebar tab:
- List configured servers with status indicator
- Add/remove/edit server configs
- Per-server enable/disable toggle
- "Test connection" button

### 6. IPC channels

- `'mcp:list-servers'` — get all configured servers with status
- `'mcp:add-server'` — add new server config
- `'mcp:remove-server'` — remove server
- `'mcp:toggle-server'` — enable/disable
- `'mcp:test-server'` — test connection, return tool list
- `'mcp:server-status-changed'` — event when server connects/disconnects

## Files to Create

- `src/shared/types/mcp.ts`
- `src/main/mcp/client.ts`
- `src/main/mcp/registry.ts`
- `src/main/mcp/ipc-handlers.ts`
- `src/main/agent/features/mcp-feature.ts`
- `src/renderer/src/components/mcp/McpPanel.tsx`

## Files to Modify

- `src/shared/types/settings.ts` — add `mcpServers` field
- `src/shared/types/ipc.ts` — add MCP channels
- `src/main/ipc/handlers.ts` — register MCP handlers
- `src/preload/api.ts` — expose MCP methods
- `src/renderer/src/components/layout/Sidebar.tsx` — enable MCPs tab

## Dependencies

None new. `child_process.spawn` handles stdio transport. JSON-RPC parsing is trivial.
