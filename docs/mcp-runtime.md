# MCP Runtime

Developer reference for the MCP runtime described by
[ADR 0048](adr/0048-openwaggle-is-the-gui-for-the-pi-ecosystem.md). User-facing behaviour is
documented under `website/src/content/docs/`; this page explains how the pieces fit.

OpenWaggle does not have its own MCP client. Every Pi session OpenWaggle creates loads Pi's
built-in MCP, codemode, and tool-search extensions, and OpenWaggle supplies Pi's plug-in points.
Everything OpenWaggle adds on top (hardened transports, connections that survive between Runs,
sampling, elicitation, MCP Apps, the vault) lives underneath Pi's client, in the **MCP transport
layer**, or beside it, in a small companion Pi extension.

```text
Pi AgentSession (one per Run, disposed by withPiSession)
 ├─ createCodemodeExtension()          codemode tool (settings owned elsewhere)
 ├─ createToolSearchExtension()        tool_search tool
 ├─ createMcpExtension({               Pi's MCP client, server state, tool registration
 │    loadConfig,                      → OpenWaggle file set, secrets resolved
 │    createTransport,                 → lease on the Session's pooled connection
 │    credentials,                     → vault-first OAuth state store
 │    openUrl,                         → automation-safe browser opening
 │    updateConfig,                    → writes to the defining file
 │    startupWaitMs: 1500 })
 └─ OpenWaggle MCP companion extension  approval (tool_call), interaction context, MCP App
                                        descriptors (tool_result), Run begin/end for the pool
                                │
                    MCP transport layer (Session Host)
 McpSessionConnectionPool ── Session ── server ── PooledConnection ── upstream McpTransport
                                                     │                 (stdio, streamable HTTP,
                                                     │                  legacy SSE, WebSocket)
                                                     └─ leases (Pi clients), internal requests
                                                        (MCP Apps), server→client requests
                                                        (sampling, elicitation, roots, ping)
```

## Module Map

| Path | Layer | Owns |
| --- | --- | --- |
| `src/main/domain/mcp/config/` | domain | Pi entry validation, file-layer merge, override semantics, tool exposure matching. Pure. |
| `src/main/adapters/mcp/config/` | adapter | File locations, reading, secret resolution, `loadConfig`, the JSON writer, `updateConfig`. |
| `src/main/adapters/mcp/credentials/` | adapter | The OAuth state backend (vault first, Pi `mcp-auth.json` read-only fallback). |
| `src/main/adapters/mcp/pool/` | adapter | Pooled connections, leases, handshake cache, id remapping, lifecycle (idle, LRU, archive, Host stop), upstream transports. |
| `src/main/adapters/mcp/migration/` | adapter | The one-time silent migration of OpenWaggle's pre-ADR-0048 files. |
| `src/main/adapters/mcp/import/` | adapter | Import from tools that are not read live (Codex, Claude Desktop, Cursor, VS Code, OpenCode, Zed). |
| `src/main/adapters/pi/mcp/` | Pi adapter | The extension factories every Pi session loads, the companion extension, approval, interactions. |
| `src/main/ports/mcp-*.ts` | ports | `McpConfigService`, `McpConnectionPool`, `McpSecretVaultService`. |
| `src/main/application/mcp-*.ts` | application | Settings and CLI operations over the ports. |
| `src/renderer/src/features/settings/.../mcp/` | renderer | Settings > MCP, a thin view over the Host's data. |
| `src/renderer/src/features/mcp/` | renderer | The MCP App host (`McpAppHost`) and its bridge. |

`openwaggle mcp serve` (OpenWaggle's own MCP server, `src/main/mcp-server-*` and
`src/main/openwaggle-mcp-*`) is unrelated to this runtime and unchanged.

## Configuration

### Files

| Order | Scope | Path | Id | Owner |
| --- | --- | --- | --- | --- |
| 1 | global | `~/.pi/agent/mcp.json` | `pi-global` | Pi |
| 2 | global | `~/.openwaggle/mcp.json` | `openwaggle-global` | OpenWaggle |
| 3 | project | `<project>/.mcp.json` | `project-mcp-json` | shared with other clients |
| 4 | project | `<project>/.pi/mcp.json` | `project-pi` | Pi |
| 5 | project | `<project>/.openwaggle/mcp.json` | `project-openwaggle` | OpenWaggle |

Every file uses Pi's `mcpServers` entry format. The project is the OpenWaggle project root (the
durable project path, not a worktree cwd); stdio `cwd` values still resolve against the session
working directory, as in Pi.

### Merge

Files are folded in order 1 → 5, so for the same server name a project entry beats a global one
and a later file beats an earlier one.

- A **full entry** (has `command`, `url`, or `type`) replaces whatever an earlier file defined.
  `source` becomes that file and any earlier override is dropped.
- An **override-only entry** (none of `command`, `url`, `type`) changes only `enabled`,
  `exposure`, and `toolExposure` of the entry defined by an earlier file, keeps everything else
  (including `env`, `headers`, `auth`), and records that file as the entry's `override`. Later
  overrides stack on earlier ones; `override` names the last one, which is where Pi writes
  enabled/exposure changes.
- An override-only entry with nothing to override is reported as a config error and skipped.
- Invalid entries are reported and skipped; other servers still load.
- `autoEnableCodemode` (top level) follows the same order: the last file that sets it wins.

Validation matches Pi (`validateMcpServerConfig`): names use letters, digits, `_`, and `-`, and
names that differ only in `-`/`_` are the same server; `type` is `stdio`, `http`, or
`streamable-http`. OpenWaggle additionally accepts `"type": "sse"` and `ws://`/`wss://` URLs (or
`"type": "websocket"`) for its legacy transports. Pi receives those as ordinary URL entries; the
loader records the real transport kind in a per-load side table that `createTransport` consults.

### Secret references

In `.openwaggle` files only (ids `openwaggle-global`, `project-openwaggle`), an `env` or
`headers` value may be `{ "secret": "<vault name>" }`. The loader resolves it from the encrypted
vault before Pi sees the config. A secret reference in any other file is a config error for that
entry, because Pi and other clients read those files. Plaintext values and Pi's `${VAR}` and
`!command` values are allowed everywhere and are resolved like Pi does, when the transport is
created.

### What Pi receives

`loadConfig(ctx)` returns Pi's `LoadedMcpConfig`:

- `servers`: one `McpServerEntry` per merged server, `source` = defining file, `scope` =
  `global` or `project`, `override` = last override file.
- `projectConfig`: `<project>/.openwaggle/mcp.json`, so Pi's "enable/disable in this project"
  writes a per-project override into OpenWaggle's file.
- `errors`: file parse errors and invalid entries.
- `autoEnableCodemode`.

Session-level MCP off and an Agent definition's MCP allowlist are applied here: a Session with MCP
off gets no servers, and an allowlist drops every server it does not name. Neither writes a file.

## Writes

| Change | Destination |
| --- | --- |
| Enable/disable, exposure, tool exposure of an existing server | The entry's `override` if it has one, else its `source`. |
| Enable/disable a global server for one project | Override-only entry in `<project>/.openwaggle/mcp.json`. |
| New server (Settings add, catalog install, import) | `~/.openwaggle/mcp.json` or `<project>/.openwaggle/mcp.json` by scope, unless the user picks another file. |
| Remove server | The defining file (and its OpenWaggle override, if any). |
| Session-level MCP off | Session state in the Host. No file. |

The writer edits one entry and keeps every other byte of the file's meaning: unrelated keys,
unknown fields, entry order, and the file's indentation. `enabled: true` and
`exposure: "codemode"` remove the key in full entries, as Pi does; overrides keep explicit
values. Pi's `updateConfig` option calls the same writer, so `/mcp` changes made inside a Run
land in the same place as Settings changes.

## Credentials

Pi stores OAuth state (client registration, tokens, PKCE verifier) keyed by
`<mcpNamespace(name)>|<url>`. OpenWaggle passes Pi a `McpOAuthCredentialStore` built on its own
`AuthStorageBackend`:

- **Reads** merge two layers: Pi's `~/.pi/agent/mcp-auth.json` (read-only fallback) and
  OpenWaggle's encrypted store (`~/.openwaggle/mcp/oauth-states.json`, OS encryption, synchronous
  I/O because Pi's backend contract is synchronous). The encrypted layer wins per key.
- **Writes** go to the encrypted layer only. Removing a key that exists only in Pi's file writes
  a tombstone holding the hash of Pi's value; the tombstone hides that value until Pi's file
  changes it (a sign-in in the `pi` CLI), so signing out in OpenWaggle never edits Pi's file and
  a later Pi sign-in still shows through.
- The refresh lock directory is `~/.openwaggle/mcp/locks`. A token from Pi's file that
  OpenWaggle refreshes is stored in OpenWaggle's layer only, so a server that rotates refresh
  tokens invalidates the copy the `pi` CLI still holds; that CLI then signs in again.
- The classes come from the pi-coding-agent patch, which only adds root exports
  (`McpOAuthCredentialStore`, `signInMcpServer`, `createMcpAuthProvider`, `validateMcpServerConfig`,
  `mcpNamespace`, `getMcpToolExposure`, `resolveConfigValueOrThrow`, `resolveHeadersOrThrow`).

Interactive sign-in stays Host-owned: Settings and the CLI ask the Host, which runs Pi's
`signInMcpServer` against the same store and opens the authorization URL with `openUrl`. During
non-disruptive automation `openUrl` never opens OS UI; the sign-in reports the URL instead.

## Transport Layer

### Pooled connections and leases

`createTransport(entry, cwd, authProvider)` is created per Pi session with the Session id bound,
and returns a **lease**: an object implementing pi-mcp's `McpTransport` that attaches to the
Session's pooled connection for that server.

- The pool key is `(sessionId, server name, connection fingerprint)`. The fingerprint hashes what
  the connection is made of (transport kind, command/args/env/cwd or URL/headers, resolved
  values). A changed definition is a different key; the old connection closes.
- `start()` opens the upstream transport if the Session has none for the key. Connection errors
  reject `start()` with the stdio stderr tail appended, so Pi's error text carries it.
- `initialize` from a lease is forwarded the first time, with OpenWaggle's client capabilities
  added (`sampling`, `elicitation`, and the MCP Apps UI extension). The result is cached; later
  leases are answered from the cache without touching the server. `notifications/initialized` is
  forwarded once per upstream.
- Requests are re-numbered upstream and mapped back, including `_meta.progressToken`, so leases
  (whose ids restart at 1) and OpenWaggle's internal requests never collide.
  `notifications/cancelled` is mapped the same way.
- `close()` detaches the lease: its in-flight requests are cancelled upstream and its listeners
  get `onClose`. The upstream stays open. This is what makes the connection survive the per-Run
  disposal of the Pi session.
- An upstream that closes, errors fatally, or reports an expired HTTP session (404) or a
  required sign-in is discarded and every attached lease is closed, so Pi's own reconnect creates
  a fresh upstream.
- A connection is never shared across Sessions, Workers, or forks: the Session id is part of the
  key and a fork or Worker is a different Session.

### Server-to-client traffic

| Server message | Handled by |
| --- | --- |
| `sampling/createMessage` | The pool, through the Session's interaction context (approval + isolated completion). Fails with a JSON-RPC error when no Run is active. |
| `elicitation/create` | The pool, through the interaction context (form or URL flow). |
| `roots/list`, `ping` | The pool (the Session's working directory as the single root). |
| Notifications (`tools/list_changed`, `resources/list_changed`, `message`, …) | Broadcast to attached leases. Dropped when none is attached; the next lease lists tools again anyway. |
| `notifications/progress` | Routed to the lease that owns the progress token. |

### MCP Apps

The layer watches `tools/list` results passing through and records, per Session and server, which
tools declare a `ui://` resource (`_meta.ui.resourceUri`) and their allowed network domains. The
companion extension's `tool_result` handler adds an MCP App descriptor to the details of such
tools' results. The renderer's `McpAppHost` reads the `ui://` resource and makes app tool calls
through Host operations that send internal requests over the same pooled connection; a missing
connection is opened on demand with the Session's current configuration. The descriptor's
`serverInstanceId` is the server name and its `serverConfigHash` the server identity, so an App
opened for a server that was since replaced is refused.

`pnpm test:mcp:conformance` runs the official MCP conformance scenarios with pi-mcp's client
through a pool lease and OpenWaggle's hardened fetch.

## Lifecycle

| Event | Effect |
| --- | --- |
| Run starts (`beginRun`) | Cancels the Session's idle timer; marks it most recently used. |
| Run ends (`endRun`) | When the Session has no other active Run, starts a 5-minute idle timer. |
| Idle timer fires | Closes all the Session's connections. |
| Session archived or deleted (including Worker auto-archive by Hive cleanup) | Closes all the Session's connections immediately (`withSessionDesktopRemoval`). |
| A Session opens its first connection while 8 Sessions hold warm connections | Closes the least recently used Session that has no active Run. |
| Signing out of a server, or switching a Session's MCP off | Closes that server's connections in every Session, or the Session's connections. |
| Session Host stops | Closes everything and waits (bounded) for stdio servers to exit. |

Stdio servers run through pi-mcp's `StdioTransport` in their own process group (POSIX) and are
closed by closing stdin, then SIGTERM and SIGKILL to the whole group, or `taskkill /T /F` on
Windows. That terminates a package runner (`npx`, `pnpm dlx`, `bunx`, `uvx`) together with the
server it launched. Child processes get OpenWaggle's child-process environment (packaged-app
`PATH`), not a spread of `process.env`.

## Approval

The companion extension's `tool_call` handler raises an OpenWaggle authorization request for
every MCP server tool (`mcp__<server>__<tool>`), whether the model called it directly, after
`tool_search`, or from a codemode script (`parentToolCallId` set). The grant key is
`{ capability: 'mcp.tool-call', requesterId: <server identity>, requester: <server name>,
resource: <MCP tool name> }`, where the server identity hashes the server name with its
transport target (command and arguments, or URL), so a different server reusing a name does not
inherit grants. Pi's resource tools are read-only and are not gated. Access modes answer these
requests exactly as before (full access answers without emitting anything).

## Removed

Per-server trust and its records, capability grants, trust tiers, the stdio sandbox, the `mcp`
gateway, `mcp_run`, capability handles and per-turn handle snapshots, OpenWaggle's MCP client,
connection slots, protocol negotiation, the encrypted tool-list cache, MCP Tasks, the Event
Inbox, Remote Skills, and the global MCP off-by-default switch. Tool names are Pi's
`mcp__<server>__<tool>`. Protocol revisions outside Pi's `SUPPORTED_PROTOCOL_VERSIONS`
(`2024-11-05` to `2025-11-25`) are unavailable until Pi adds them.
