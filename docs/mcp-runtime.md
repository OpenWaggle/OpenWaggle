# MCP Runtime

Developer reference for the MCP runtime described by
[ADR 0050](adr/0050-openwaggle-is-the-gui-for-the-pi-ecosystem.md). User-facing behaviour is
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
| `src/main/adapters/mcp/migration/` | adapter | The one-time silent migration of OpenWaggle's pre-ADR-0050 files. |
| `src/main/adapters/mcp/import/` | adapter | Import from tools that are not read live (Codex, Claude Desktop, Cursor, VS Code, OpenCode, Zed). |
| `src/main/adapters/mcp/registry/` | adapter | MCP Registry search and install: package launchers, OCI digest pinning, verified MCPB bundles. |
| `src/main/adapters/pi/mcp/` | Pi adapter | The extension factories every Pi session loads, the companion extension, approval, interactions. They reach the pool only through `pool/mcp-connection-pool-api.ts` and receive it as an argument. |
| `src/main/mcp-runtime-layers.ts` | composition | The Host's one pool (with OpenWaggle's connection hooks) and what is built over it: the agent kernel, the server and App runtime services, Host stop. Session removal gets it from `mcp-host-start.ts`. |
| `src/main/ports/mcp-*.ts` | ports | `McpConfigurationService`, `McpServerRuntimeService`, `McpAppRuntimeService`, `McpImportService`, `McpRegistryService`, `McpSecretVaultService`. The connection pool is not a port: it lives in the pool adapter. |
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
created. The resolved vault value is passed to Pi escaped (`piLiteral`), so a secret that contains
`$` or starts with `!` stays literal.

`${VAR}` in `env`, `headers`, and `oauth.clientSecret` is resolved against the login shell's
environment (`mcp-shell-environment.ts`: `env -0` in a login shell, or PowerShell on Windows,
captured once at startup), with the process environment winning. This matters for an app opened
from the Dock, whose own environment lacks the shell profile's variables. It applies to MCP only.
`url`, `command`, `args`, and `cwd` are not interpolated, because Pi does not interpolate them.
A value that cannot be resolved fails that server's check or connection only; inspection,
`openwaggle mcp list`, and `doctor` report it per server, and the configuration view lists vault
errors with the other config errors.

Imports from other tools convert only the variable syntax that tool really expands (Claude's CLI
`${VAR}`, Cursor/VS Code/Windsurf `${env:VAR}`, OpenCode `{env:VAR}`, VS Code `${input:id}`) to
`${VAR}`; every other `$` and a leading `!` are escaped.

Writes resolve a symbolic link and replace the file it points to (temporary file beside it). Pi's
global file is `getPiAgentDir()/mcp.json` (honouring `PI_CODING_AGENT_DIR`) for the migration as
for the loader. File locations are de-duplicated by path, so a project at the home folder reads
`~/.openwaggle/mcp.json` once, as the global file. Pi gets no `projectConfig` for it, so `/mcp`
"in this project" cannot write the global file, and the migration logs (does not apply) the old
per-project switches of that project (`home-project-state.ts`), which would change every project.

### What Pi receives

`loadConfig(ctx)` returns Pi's `LoadedMcpConfig`:

- `servers`: one `McpServerEntry` per merged server, `source` = defining file, `scope` =
  `global` or `project`, `override` = last override file.
- `projectConfig`: `<project>/.openwaggle/mcp.json`, so Pi's "enable/disable in this project"
  writes a per-project override into OpenWaggle's file.
- `errors`: file parse errors and invalid entries.
- `autoEnableCodemode`.

Session-level MCP off and an Agent definition's MCP allowlist are applied here for the configured
servers, and again for servers Pi extensions register (`pi.registerMcpServer`), which never pass
through `loadConfig`: a Session with MCP off loads no MCP extension at all, and `createTransport`
refuses a server the allowlist does not name. Neither writes a file. Sampling and elicitation from
an extension's server are answered during a Run like any other server's, under the identity its
lease names.

An Agent definition's tool allowlist is enforced by a `tool_call` hook
(`createAgentToolAllowlistGuard`) that is the first of OpenWaggle's inline extensions, ahead of
MCP approval, so a refused call is never offered for approval. Pi loads extensions from paths and
packages before every inline factory, so their `tool_call` hooks see a call before the guard.

## Writes

| Change | Destination |
| --- | --- |
| Enable/disable, exposure, tool exposure of an existing server | The entry's `override` if it has one, else its `source`. |
| Enable/disable a global server for one project | Override-only entry in `<project>/.openwaggle/mcp.json`. |
| New server (Settings add, catalog install, Registry install, import) | `~/.openwaggle/mcp.json` or `<project>/.openwaggle/mcp.json` by scope, unless the user picks another file. |
| Remove server | The defining file (and its OpenWaggle override, if any). |
| Session-level MCP off | Session state in the Host database (`session_mcp_disabled`), kept across Host restarts and archiving (an unarchived Session still has MCP off), copied to a fork or clone, and dropped when the Session is deleted. Switching off closes the Session's connections at once and refuses its running Run's leases; switching on applies from the next Run, which loads the MCP extension again. No file. |

The writer (`mcp-config-file-edit.ts`) applies text edits with `jsonc-parser` to only the keys a
change touches, because `.mcp.json` and `.pi/mcp.json` are often committed: unrelated keys,
unknown fields, entry order, indentation, line endings, files written on one line, and the file
mode (group-writable included, whatever the umask) stay as they were. In a multi-line file, an
entry written on one line is spread over lines in the file's indentation when a key is added. Pi's own writer re-serializes the whole file, so it is not used. `enabled: true` and
`exposure: "codemode"` remove the key in full entries, as Pi does; overrides keep explicit
values. Pi's `updateConfig` option calls the same writer, so `/mcp` changes made inside a Run
land in the same place as Settings changes.

## Registry Install

Settings > MCP and `openwaggle mcp registry` search the MCP Registry
(`registry.modelcontextprotocol.io`, `/v0.1/servers`) and install a server through the Host
channels `mcp:search-registry`, `mcp:get-registry-server`, and `mcp:install-registry-server`
(Host UI revision 22). `McpRegistryService.prepareEntry` turns one Registry server into an
ordinary Pi entry, and the application operation saves it with `McpConfigurationService.addServer`
to OpenWaggle's file for the chosen scope. A name already configured in any file (with Pi's
`-`/`_` equivalence) is refused rather than shadowed.

| Registry option | Pi entry |
| --- | --- |
| Remote `streamable-http` / `sse` | `url`, plus `"type": "sse"` for SSE. URLs with `{variables}` are not offered. |
| `npm` / `pypi` / `nuget` | `npx --yes <id>@<version>`, `uvx <id>==<version>`, `dnx <id>@<version> --yes`. Exact versions only. |
| `oci` | `docker run --rm -i [-e NAME]… <repo>@sha256:…`, the digest Docker reports after `docker pull`. No Docker options from the Registry. |
| `mcpb` | Downloaded from a GitHub/GitLab release URL, SHA-256 checked, unpacked into `~/.openwaggle/mcp/registry-cache/mcpb/<sha256>` (paths, symlinks, sizes bounded); `command`/`args` from the manifest, `cwd` = the bundle. |

Package arguments follow the package: a `positional` argument is its value, and a `named` one is
`--flag=value` as the server.json schema describes it (`NamedArgument`), or the bare flag when it
has no value. Runner arguments are checked in the same form, so a flag cannot pass as a value.

Without a chosen method the hosted URL wins, then the first stdio package. Declared secrets (and
values without a default) become `{ "secret": NAME }` references, which is why the install only
writes OpenWaggle's files; the result lists them so the UI can ask for them. Registry and
manifest literals are escaped (`$` → `$$`, leading `!` → `$!`) so Pi never reads them as `${VAR}`
or `!command`. Downloads go through the hardened fetch with size and time bounds. Nothing about
the Registry is written into the entry except `description`.

`openwaggle mcp doctor` composes `mcp:get-configuration` and `mcp:inspect-server`: the files and
which exist, the errors Pi reports for them, and every enabled server's state with its stderr
tail.

## Credentials

Pi stores OAuth state (client registration, tokens, PKCE verifier) keyed by
`<mcpNamespace(name)>|<url>`. OpenWaggle passes Pi a `McpOAuthCredentialStore` built on its own
`AuthStorageBackend`:

- **Reads** merge two layers: Pi's `~/.pi/agent/mcp-auth.json` (read-only fallback) and
  OpenWaggle's encrypted store (`<userData>/mcp/oauth-states.json`, OS encryption, synchronous
  I/O because Pi's backend contract is synchronous). The encrypted layer wins per key. The store
  is per build (ADR 0032): dev and release builds encrypt with different keys, so a shared file
  would be unreadable to one of them. A store that decrypts but cannot be parsed is renamed to
  `oauth-states.json.unreadable-<time>`, logged once, and the store starts empty. A store that does
  not decrypt (another build's key, a keychain that refused) is left untouched: its sign-ins are
  unavailable to that process, and a change is refused rather than written over them.
- The store every build shared before, `~/.openwaggle/mcp/oauth-states.json`, is copied into a
  build's user data the first time that build has no store and can decrypt it. It is never
  changed. The encrypted secret vault (`vault.json`) moved the same way: a build takes the
  shared vault's secrets it can decrypt.
- **Writes** take the store's cross-process lock (`withProcessFileLockSync`, bounded wait), read
  the encrypted layer again, and apply only what the caller changed, so a sign-in the CLI or
  another Host saved meanwhile is kept. The decoded layer is cached while the file's inode, size,
  and mtime stay the same, so the token read on every MCP request does not decrypt each time.
- **Writes** go to the encrypted layer only. Removing a key that exists only in Pi's file writes
  a tombstone holding the hash of Pi's value; the tombstone hides that value until Pi's file
  changes it (a sign-in in the `pi` CLI), so signing out in OpenWaggle never edits Pi's file and
  a later Pi sign-in still shows through.
- The refresh lock directory is `<userData>/mcp/locks`. A token from Pi's file that
  OpenWaggle refreshes is stored in OpenWaggle's layer only, so a server that rotates refresh
  tokens invalidates the copy the `pi` CLI still holds; that CLI then signs in again.
- The classes come from the pi-coding-agent patch, which only adds root exports
  (`McpOAuthCredentialStore`, `signInMcpServer`, `createMcpAuthProvider`, `validateMcpServerConfig`,
  `mcpNamespace`, `getMcpToolExposure`, `resolveConfigValueOrThrow`, `resolveHeadersOrThrow`).

Interactive sign-in stays Host-owned: Settings and the CLI ask the Host, which runs Pi's
`signInMcpServer` against the same store. A Run's `/mcp` sign-in goes through Pi's `openUrl`.
A Run's opener matches the page to the configured servers and to the servers Pi extensions
registered (`pi.getMcpServers()`, read on `session_start`, `mcp-extension-servers.ts`). Settings
lists only configured servers, so an extension's server signs in during a Run only.

Both open a page only after `checkMcpAuthorizationUrl` (`adapters/mcp/credentials/`) accepts it:
`https:` or `http:` (the transport reaches these hosts over plain http too; any other scheme is
refused), no credentials, and the host of the server, of the
authorization server Pi discovered and saved for it, of that server's authorization endpoint, or
of the configured `oauth.authServerMetadataUrl`; pi-mcp itself only refuses `javascript:`,
`data:`, and `vbscript:`. Pi's `openUrl` receives only the URL, so the page is matched to its
server by the pending sign-in's `state`. During non-disruptive automation the GUI and the
detached Session Host both install the desktop UI blockers, so nothing opens; the Host-owned
sign-in reports the URL instead.

Token refreshes go through the hardened fetch: OpenWaggle sends the stored token as it is, and
an expired one gets the server's 401, after which Pi refreshes through the fetch the transport
hands to `onUnauthorized` (`mcp-hardened-auth-provider.ts`). Pi's `signInMcpServer` (discovery,
dynamic client registration, the code exchange) and its proactive refresh accept no fetch, so
the sign-in itself still uses `globalThis.fetch`; the page check above is what guards it.

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
- An upstream that closes or errors fatally is discarded and every attached lease is closed, so
  Pi's own reconnect creates a fresh upstream. After an expired HTTP session (404) or a required
  sign-in the connection retires: it takes no new leases or requests, closes once the requests
  already sent are answered (or after 30 s), and any request still open then gets an error
  response. Closing also closes what the upstream holds beside its transport (the pinned-DNS
  fetch of HTTP and SSE servers).
- Legacy SSE servers get the Pi auth provider through a wrapped fetch (bearer token, one retry
  after `onUnauthorized`, then `McpAuthRequiredError`). Legacy WebSocket servers follow the HTTP
  rules: plain `ws:` and private addresses are allowed for the configured server.
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

### Tool schemas

Pi registers each MCP tool's `inputSchema` as its parameters and only forces an object root, but
Bedrock and OpenAI refuse a root `anyOf`/`oneOf`/`$ref`, and OpenAI-completions providers send
empty arguments for one. The layer rewrites every `tools/list` result (`adaptResult`,
`adapters/pi/mcp/mcp-tool-schema-repair.ts`) with the same `providerToolParameters` repair as
OpenWaggle's own tools before Pi's client reads it. Codemode, deferred, and direct tools all get the
repaired schema; the server still validates the arguments it receives.

### MCP Apps

The layer watches `tools/list` results passing through and records, per Session and server, which
tools declare a `ui://` resource (`_meta.ui.resourceUri`) and their allowed network domains. The
companion extension's `tool_result` handler adds an MCP App descriptor to the details of such
tools' results. The renderer's `McpAppHost` reads the `ui://` resource and makes app tool calls
through Host operations that send internal requests over the same pooled connection; a missing
connection is opened on demand exactly like a Run's (the Session's working path for `cwd` and
roots, Pi's OAuth settings, the server identity), so the next Run reuses it. Apps can also list the
server's resources and prompts (`mcp:list-app-catalog`); every App request gives up after 60 s.
The descriptor's
`serverInstanceId` is the server name and its `serverConfigHash` the server identity, so an App
opened for a server that was since replaced is refused.

`pnpm test:mcp:conformance` runs the official MCP conformance scenarios with pi-mcp's client
through a pool lease, OpenWaggle's hardened fetch, and the connection hooks a Run's connection
gets: `initialize`, `tools_call`, and `json-schema-2020-12-preservation` (SEP-1613, SEP-2106).

Tool schemas reach Pi's client as the server sent them, except for one deliberate change: the
transport rewrites a `tools/list` result whose tool `inputSchema` has a root keyword a provider
refuses (`mcp-tool-schema-repair.ts`). Bedrock, Anthropic, and OpenAI need an object root without
`allOf`/`anyOf`/`oneOf`, `$ref`, or `if`/`then`/`else`, so those root keywords are flattened or
dropped; a schema without them is passed on unchanged, and `$schema`, `$defs`, `$anchor`,
`additionalProperties`, and every nested keyword are kept. The server still validates the
arguments against its own schema. Pi registers the listed schema as the model's tool parameters
and offers no later point to repair it, so the repair stays in the transport. Settings and MCP
Apps read the listing before it (`observeResult`). The conformance scenario therefore reports
SEP-2106's composition and conditional checks as skipped at 2025-11-25.

## Lifecycle

| Event | Effect |
| --- | --- |
| Run starts (`beginRun`) | Cancels the Session's idle timer; marks it most recently used. |
| Run ends (`endRun`) | When the Session has no other active Run, starts a 5-minute idle timer. |
| Idle timer fires | Closes all the Session's connections. |
| Session archived or deleted (including Worker auto-archive by Hive cleanup) | Closes all the Session's connections immediately (`withSessionDesktopRemoval`). |
| A Session opens its first connection while 8 Sessions hold warm connections | Closes the least recently used Session that has no active Run. |
| Signing in to or out of a server, or switching a Session's MCP off | Closes the connections to that server identity (name plus command or URL) in every Session, or the Session's connections. |
| A saved MCP change (Settings, the CLI, Pi's `/mcp`) turns a server off or removes it | Closes each Session's connection to it where its own project no longer has it on (`mcp-turned-off-servers.ts`); that Session's Run leases of it are refused until its next Run. A project whose files cannot be read is left alone. MCP Apps check `enabled` before using a warm connection. |
| Session Host stops | Closes everything and waits (bounded) for stdio servers to exit. Leases are refused afterwards, except for a Session that begins a new Run. |
| Any of the explicit closes above (`closeSession`: archive, delete, MCP switched off) | The Session's running Run cannot reconnect: its leases are refused until its next `beginRun`. Idle and LRU closes do not refuse anything. |

Stdio servers run through pi-mcp's `StdioTransport` in their own process group (POSIX) and are
closed by closing stdin, then SIGTERM and SIGKILL to the whole group, or `taskkill /T /F` on
Windows. That terminates a package runner (`npx`, `pnpm dlx`, `bunx`, `uvx`) together with the
server it launched. pi-mcp skips all of that when the process it started has already exited,
so after the transport closes OpenWaggle signals the whole group anyway (SIGTERM, then SIGKILL),
and a server a launcher left behind does not survive (POSIX; Windows relies on pi-mcp's
`taskkill /T`). Child processes get the user's environment (`{ ...process.env }`, as Pi
does) with the packaged app's npm-compatible `PATH`, plus the entry's resolved `env` (resolved
against the login-shell environment as above).

## Settings state without connecting

Opening Settings > MCP calls `mcp:get-server-statuses` (`McpServerRuntimeService.getServerStatuses`),
which starts no server and sends no request. For each configured server it reports, in order:

1. **`live`**: a Session holds an open connection with the same server identity
   (`mcpServerIdentity`). The pool's `connectionStates(identity)` reads `ready` and the last error
   without touching recency or handing the connection out; tools are the ones the Session's Run
   listed. Nothing is sent over another Session's lease.
2. **`last-check`**: the in-memory last known state per server identity
   (`adapters/pi/mcp/mcp-server-status-registry.ts`). `inspectServer` ("Check connection",
   `openwaggle mcp list`) records its result, and the connection hooks' `observeResult` records
   every `tools/list` result a Run receives. Tool exposure is applied from the current
   configuration when read. Signing in or out forgets the server's entry.
3. **`not-checked`**: nothing is known; the UI says "Not checked yet".

`mcp:inspect-server` connects outside any Session and runs only on **Check connection** and in the
CLI's `list`. The state is in memory only, so it starts empty after the Host restarts.

## Approval

The companion extension's `tool_call` handler raises an OpenWaggle authorization request for
every MCP server tool (`mcp__<server>__<tool>`), whether the model called it directly, after
`tool_search`, or from a codemode script (`parentToolCallId` set). The grant key is
`{ capability: 'mcp.tool-call', requesterId: <server identity>, requester: <server name>,
resource: <MCP tool name> }`, where the server identity hashes the server name with its
transport target (command and arguments, or URL), so a different server reusing a name does not
inherit grants. The server is found through the tool's namespace (`mcpNamespace`, which maps
`-` and `_` alike); the merge refuses a second server whose name maps to a namespace already
taken (`server "a_b" conflicts with "a-b"`), so a grant can never resolve to the wrong one of two
look-alike servers. Pi's resource tools are read-only and are not gated. Access modes answer these
requests exactly as before (full access answers without emitting anything).

## Migration

`adapters/mcp/migration/` runs once per file, silently, with one `.pre-adr-0048.bak` backup, and
records what it did in `~/.openwaggle/mcp/migration.json`. The global file's backup sits next to
it; a project file's goes to `~/.openwaggle/mcp/backups/<project>-<hash of its path>/`, never
into the repository, where it could be committed (`migrationBackupPath`). A backup an earlier
build left next to a project file is still read as the old content. Unchanged copies of Pi entries are
removed, `directTools` becomes `exposure`/`toolExposure`, and OpenWaggle-only fields are converted
or dropped. It also keeps every server as on or off as it was (`legacy-enablement.ts`): the old
code read only `~/.openwaggle/mcp.json`, `.mcp.json`, and the project's `.openwaggle/mcp.json`, and
connected a server only when MCP was on (project switch, else the global switch, default off), its
state record said `enabled: true`, and it was not muted for the project. Where the new merge would
differ, the migration writes `enabled` into OpenWaggle's global file (a project that inherits
everything) and into each project's file. This covers projects OpenWaggle knew on the first run:
settings, every Session's project and workspace root, and the old state. Projects added later,
and users with no old state and no global file, get the new behaviour. Files are migrated only
in project roots (settings and Sessions' project paths), never in a managed worktree, where a
new `.openwaggle/mcp.json` would be an untracked file in the user's checkout.

The old code also named each server by an instance ID (`servers[*].instanceId` in
`~/.openwaggle/mcp/state.json`), and Agent definitions and Session execution profiles could list
servers by it. The migration records which server name each ID stood for (`legacyServerNames` in
`migration.json`, `legacy-server-names.ts`). Agent-definition validation accepts an ID whose server
is still configured, and a Run's and an MCP App's server allowlist replace IDs with names.
MCP Apps in transcripts from before the upgrade name their server by that ID and the old config
hash. The migration also records, per ID, the hash the server was last turned on with and the
identity (`mcpServerIdentity`) of what its old entry ran or connected to
(`legacyServerIdentities`). Such an App opens while both still match; otherwise it stays closed
and says to run its tool again, as an App of a changed server does.

## Removed

Per-server trust and its records, capability grants, trust tiers, the stdio sandbox, the `mcp`
gateway, `mcp_run`, capability handles and per-turn handle snapshots, OpenWaggle's MCP client,
connection slots, protocol negotiation, the encrypted tool-list cache, MCP Tasks, the Event
Inbox, Remote Skills, and the global MCP off-by-default switch. Tool names are Pi's
`mcp__<server>__<tool>`. Protocol revisions outside Pi's `SUPPORTED_PROTOCOL_VERSIONS`
(`2024-11-05` to `2025-11-25`) are unavailable until Pi adds them.
