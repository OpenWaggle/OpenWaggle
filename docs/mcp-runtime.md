# MCP Runtime

Developer reference for the MCP runtime described by
[ADR 0051](adr/0051-openwaggle-is-the-gui-for-the-pi-ecosystem.md). User-facing behaviour is
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
| `src/main/adapters/mcp/migration/` | adapter | The one-time silent migration of OpenWaggle's pre-ADR-0051 files. |
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
- An override-only entry with nothing to override is skipped. In OpenWaggle's own files (an
  override OpenWaggle wrote for a server since removed) it is a warning (`warnings` in the merged
  config and the view, shown in Settings as ignored); in any other file it is a config error.
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
errors with the other config errors. The configuration view and Settings' server states
(`getMcpServerStatuses`) only check that each referenced secret exists (`checkMcpVaultSecret`),
without decrypting it; a server that is on but whose secret is missing is not checked and
shows "Needs secret" (`needsSecret`), since Runs leave it out until the secret is saved. A
secret this build cannot decrypt is reported when a Run or a check reads it. Server states, inspect and
sign-in still read whether a server is signed in (`mcpSignedIn`) from the synchronous sign-in
store, which decrypts on the main thread when the file changed (cached by mtime).

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

- `servers`: one `McpServerEntry` per merged server, with `scope` = `global` or `project`. Pi
  knows one kind of override, a project file's override of a global server ("global, project
  override", saved to the project file), so `override` (the last override file) is set only for
  that. Any other override, a global file's or one of a project server, is where `updateConfig`
  saves changes, so Pi gets it as `source` instead of the defining file, and `/mcp` names the file
  that is written. Without an override, `source` is the defining file (`runtimeEntry` in
  `mcp-runtime-config.ts`).
- `projectConfig`: `<project>/.openwaggle/mcp.json`, so Pi's "enable/disable in this project"
  writes a per-project override into OpenWaggle's file.
- `errors`: file parse errors and invalid entries, and the automation notice below.
- `autoEnableCodemode`.

Under non-disruptive automation (`OPENWAGGLE_AUTOMATION=1`) the connectable merge leaves out
every server whose defining file is a project file (`.mcp.json`, `.pi/mcp.json`,
`.openwaggle/mcp.json`), unless `OPENWAGGLE_AUTOMATION_PROJECT_MCP=1` asks for them
(`connectsProjectMcpServers` in `mcp-automation-policy.ts`). Hidden QA runs on the developer's
own checkout, and this repository's `.mcp.json` runs `npx -y chrome-devtools-mcp` against the QA
app's own CDP port. Project overrides of global servers still apply, the management view still
lists the project servers, and `mcpLeftOutServerNotice` names the policy for one of them.

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

### Runtime exposure

OpenWaggle runs a file's `direct` exposure, server-level or per tool, as `codemode`
(`withOpenWaggleRuntimeExposure`, `domain/mcp/config/mcp-runtime-exposure.ts`), applied in
`loadMcpRuntimeConfig` so every runtime consumer (Runs, Settings tool views, MCP Apps) agrees.
`merged` keeps what the files say; nothing is written back, so `pi` still sees `direct`. Servers
Pi extensions register get the same rewrite where Pi's MCP extension reads them
(`withOpenWaggleMcpExposure`, `adapters/pi/mcp/mcp-openwaggle-exposure.ts`, a proxy over
`getMcpServers`). MCP App tools are the exception: App tools known when the Run starts (this
Session's `mcp-app-registry` listing, else the status registry's last listing of the server
identity) are given to Pi as exact `toolExposure` `direct` entries in `loadConfig`, so Pi waits
for their server; an App tool first listed during the Run is re-registered `direct` by the same
proxy's `registerTool` (Pi names an MCP tool's server in `namespace.aliases[0]` and its label
`<server>/<tool>`). Only tools that would run as `codemode` are promoted; hidden and deferred
ones keep their exposure. Settings > MCP offers codemode or hidden (`mcpExposureChoices`) and
shows `direct` as codemode (`mcpShownExposure`, via `@shared/utils/mcp-exposure`).

### Pi's commands and notices

Pi's MCP extension is written for its terminal: a `/mcp` menu, and notices and tool errors that
say "Run /mcp to fix." or "Run /mcp to sign in.". OpenWaggle manages servers in Settings > MCP, so
`forOpenWaggleMcpSurface` (`adapters/pi/mcp/mcp-openwaggle-surface.ts`) wraps the extension:
`/mcp` is not registered (the slash menu never offers it), notices and tool results that name
`/mcp` or `/login <provider>` name Settings > MCP or Settings > Connections instead, and the `info`
notices of Pi's `before_agent_start` wait are dropped (see [When servers connect](#when-servers-connect)).
Only Pi's exact wording is rewritten, so a server's own text is left alone. The rest of this page
still names Pi's `/mcp` where Pi's `updateConfig` and `openUrl` options are described. With `/mcp`
gone, nothing in a Run reaches them today; they stay wired so that anything in Pi's extension that
writes or signs in lands the same way as Settings.

## Writes

| Change | Destination |
| --- | --- |
| Enable/disable, exposure, tool exposure of an existing server | The entry's `override` if it has one, else its `source`. |
| Enable/disable a global server for one project | The project's existing override of the server (for example in `.pi/mcp.json`) if it has one, else an override-only entry in `<project>/.openwaggle/mcp.json`. |
| New server (Settings add, catalog install, Registry install, import) | `~/.openwaggle/mcp.json` or `<project>/.openwaggle/mcp.json` by scope, unless the user picks another file. |
| Remove server | The entry in the file that defines it. When no other file still defines the server, its override-only entries in OpenWaggle's files are removed too, for a global server in every project OpenWaggle knows (settings and Session project roots, not managed worktrees); those in Pi's files and `.mcp.json` are left as they are and listed as errors. |
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
(Host UI revision 24). `McpRegistryService.prepareEntry` turns one Registry server into an
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
  changed. The encrypted secret vault (`vault.json`) moved the same way. Until a build
  has its own vault, it reads the shared one: names without decrypting (`list`, `has`), and a value
  decrypted only when resolved (another build's entry is not found). Its first save copies the
  shared secrets it can decrypt, under the vault's lock; a save whose keychain is unavailable
  or does not answer fails and records nothing. Reads keep no takeover state, so nothing is hidden by a concurrent or failed
  attempt, and a dev build next to a release build reads no keychain to list or check secrets.
- Limit: a shared entry, or a shared sign-in store, that this build's key does not open is taken
  to be another build's. That cannot be told apart from a transient failure: on Linux, Chromium
  falls back from its `v11` keyring key to the `v10` one while the keyring is locked, so an entry
  read then fails to decrypt. The first save, or the first sign-in store write, then takes over
  without it, and from then on the build does not see it again. Unlock the keyring before the
  build's first save if old secrets matter.
- The migration of pre-ADR-0051 sign-ins is recorded per build in `migration.json` (keyed by the
  build's user data): only the build whose key sealed an old sign-in can move it. A build that
  finds the sign-in in the shared vault but cannot decrypt it records nothing, so the other build
  still moves it.
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
- A server process can get stuck without closing. Datadog's `datadog_mcp_cli` (a stdio proxy to
  Datadog's HTTP endpoint) does this: once its own HTTP connection breaks, it answers every
  request with JSON-RPC "Internal error" for as long as it lives, and a warm connection would hand
  that process to every later Run ("datadog: failed: Internal error" each time). When a listing
  (`tools/list`, `resources/list`, `resources/templates/list`, `prompts/list`) gets an internal
  error, the connection replaces its process: it closes it, opens a fresh one, initializes it with
  the first `initialize` params, and sends the listing again, so the lease never sees the error
  (`mcp-upstream-replacement.ts`, with `mcp-upstream-slot.ts` owning the process). Clients'
  messages wait while that happens. The connection only does this when nothing else is open on
  the old process (no client or OpenWaggle request, and none of the server's own requests, whose
  answer would reach the fresh process), and at most once a minute. Otherwise, or when the fresh process fails its
  `initialize` or the same listing, the lease gets the error and the connection retires, so the next Run opens its own process.
  A failed `tools/call` is never sent again: the tool may already have done its work.
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
The frame's
Content-Security-Policy allows the origins the resource declares in `_meta.ui.csp`, validated as
plain origins (ADR 0053), and the document is served from its own `openwaggle-mcp-app://frame-<uuid>` origin with that policy as a header (`mcp-app-frame-protocol.ts`; a `srcdoc` frame would inherit the page's CSP). The frame sizes itself to the height the App reports and gets the
panel's width and theme as host context changes (`McpAppHost`, `use-mcp-app-frame-layout.ts`). The descriptor's
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

### When servers connect

Nothing connects at Host start: migration, the turned-off-server check, and Settings (which reads
known state, `mcp-server-status-registry`) open no connection. A server connects only when a
Session uses MCP: a Run, an MCP App request, or **Check connection** in Settings.

A Run connects **every enabled server of its Session** when its Pi session starts, whatever the
exposure: Pi's MCP extension starts all connections on `session_start`, in the background. That
is Pi's design, and OpenWaggle keeps it (ADR 0051, Pi portability). Pi needs each server's tool
listing before the model can reach it, whatever the exposure:

- `codemode`: `searchTools()` and the codemode tool's namespaces;
- `deferred`: `tool_search`;
- the `mcp_servers` section of the system prompt, with each server and its instructions;
- the resource tools;
- the MCP App metadata OpenWaggle reads from `tools/list`.

"Lazy" in ADR 0051 means a connection never blocks a message. Only servers with `direct` tools
are waited for before the first request, for at most `startupWaitMs` (1.5 s). OpenWaggle runs a
file's `direct` as `codemode` (ADR 0051 amendment, see Runtime exposure), so the only direct tools Pi sees are
MCP App tools known when the Run starts, and only their servers are waited for. A codemode script,
`tool_search`, or a resource tool waits for the servers it needs when it runs. Before that, a
Run with a server turned on waits for the login-shell environment the Host reads once at start
(`mcpShellEnvironmentReady`, at most 5 s per shell it tries) and, when one of them is a URL server
(the kind that signs in), for the scope's sign-in migration: both are done after the first such
Run in a Host process. When that migration fails because the keychain did not answer or could
not be used, it is tried again after `MCP_MIGRATION_KEYCHAIN_RETRY_MS` (5 min) rather than
`MCP_MIGRATION_RETRY_MS` (5 s), so Runs do not wait for the keychain again and again. A Run with no server turned on
waits for neither and reads no keychain; it still awaits `migrateOpenWaggleMcpFilesOnce`, which
is done for the projects Host start knows. For a project not yet migrated, or one retrying after
a failure, it can take the migration lock (at most 30 s), wait behind a sign-in pass in the shared
queue, and make the git calls of `keepMcpFileOutOfGit`. A separate queue would not help: both
parts take the same cross-process migration lock. Loading the configuration to connect (a Run,
Check connection, an MCP App) never reads the keychain: it loads with `deferredMcpVaultSecret`,
so a present secret becomes a deferred marker (`mcp-deferred-secrets.ts`) and a missing one
leaves its server out. A marker is read from the keychain when that server's connection opens,
including a server that was off when the Run started and `/mcp` turns on. Check connection and
MCP Apps load only their own server. A server a Pi extension registers in such a Run
starts with whatever environment the Host has read by then. Connections are
pooled per Session (below), so the next Run reuses them instead of starting the servers again.
Pi's MCP extension still connects every enabled server at `session_start`, but the connection is
a lease on the pool, which can answer without a server process:

- **Tool catalogs (D1.3, C2-a).** Every pooled connection records its server's last `initialize`
  result and `tools/list` pages (`mcp-connection-catalog.ts`), keyed by server identity, connection
  fingerprint without the Run's working directory, and project (`mcp-tool-catalogs.ts`), in
  `<userData>/mcp/tool-catalogs/`. A catalog younger than a day is served: a Session's Pi client gets
  `initialize`, `tools/list` and `ping` from it at once, so its tools are registered before the
  first model request of every Run instead of mid-Run.
- **Lazy start (stdio only).** A stdio server with a served catalog starts when a request needs it
  (`mcp-connection-lazy-start.ts`): a tool call, resources, prompts, or an OpenWaggle request. It is
  initialized with the client's own `initialize` params (and `notifications/initialized` if the
  client sent it), then its tools are listed again; when they differ from the catalog, clients get
  `notifications/tools/list_changed` and Pi re-lists. A server that fails to start loses its catalog,
  so the next Session starts it at once and reports the failure. Each Session still has its own
  process (ADR 0013); a Session that never calls a server never starts it. URL servers connect as
  before (they hold no process, and sign-in needs the handshake).
- **Stable `<mcp_servers>` (C9).** A server without a configured `description` is described by the
  first line of its cached `instructions`, so the section Pi renders is the same before and after
  the server connects.

| Event | Effect |
| --- | --- |
| Run starts (`beginRun`) | Cancels the Session's idle timer; marks it most recently used. |
| Run ends (`endRun`) | When the Session has no other active Run, starts a 5-minute idle timer, or a 1-minute one for a Hive Worker whose Delegation is `ready_for_review`, `accepted` or `cancelled` (`mcp-settled-worker-idle-policy.ts`). |
| Idle timer fires | Closes all the Session's connections. |
| Session archived or deleted (including Worker auto-archive by Hive cleanup) | Closes all the Session's connections immediately (`withSessionDesktopRemoval`). |
| A Session opens its first connection while 3 Sessions hold warm connections | Closes the least recently used Session that has no active Run. |
| Signing in to or out of a server, or switching a Session's MCP off | Closes the connections to that server identity (name plus command or URL) in every Session, or the Session's connections. |
| A saved MCP change (Settings, the CLI, Pi's `/mcp`) turns a server off or removes it | Closes each Session's connection to it where its own project no longer has it on (`mcp-turned-off-servers.ts`); that Session's Run leases of it are refused until its next Run. A project whose files cannot be read is left alone. MCP Apps check `enabled` before using a warm connection. |
| Session Host stops | Closes everything and waits (bounded) for stdio servers to exit. Leases are refused afterwards, except for a Session that begins a new Run. |
| Any of the explicit closes above (`closeSession`: archive, delete, MCP switched off) | The Session's running Run cannot reconnect: its leases are refused until its next `beginRun`. Idle and LRU closes do not refuse anything. |

Stdio servers run through pi-mcp's `StdioTransport` in their own process group (POSIX) and are
closed by closing stdin, then SIGTERM and SIGKILL to the whole group, or `taskkill /T /F` on
Windows. That terminates a package runner (`npx`, `pnpm dlx`, `bunx`, `uvx`) together with the
server it launched. Once a runner launch has run, a background probe (`npx --yes
--package=<spec> -- node -e …`, and the same for `npm exec`, `pnpm dlx`, `bunx`) records the bin the
runner resolved, and later launches spawn it directly with the runner's `node` and its
`node_modules/.bin` first on `PATH` (`mcp-package-runner-bypass.ts`, D1.2), saving the ~80 MB runner
process per server and the registry check `@latest` makes on every launch. Resolutions live in
`<userData>/mcp/package-runner-bins.json`, keyed by runner, spec, working directory and `PATH`; a
tag or range is resolved again after a day, an exact version after a week, and Check connection
always launches through the runner and probes again. Forms the bypass cannot reproduce (several
`--package`s, `-c`, git or file specs, unknown runner flags) keep the runner. pi-mcp skips all of that when the process it started has already exited,
so after the transport closes OpenWaggle signals the whole group anyway (SIGTERM, then SIGKILL),
and a server a launcher left behind does not survive (POSIX; Windows relies on pi-mcp's
`taskkill /T`). Child processes get the user's environment (`{ ...process.env }`, as Pi
does) with the packaged app's npm-compatible `PATH`, plus the entry's resolved `env` (resolved
against the login-shell environment as above).

## Settings state without connecting

Each configured server in the view names the vault secrets its `env` or `headers` read
(`McpConfiguredServerView.vaultSecrets`, names only). Settings compares them with the vault's
list, which needs no decryption, and shows "Needs secret X" on the row and in the detail, with
"Add in Secrets", which opens Secrets with the name filled in. A server with a missing secret is
left out of Runs (`loadMcpRuntimeConfig`'s `unavailable`) until the secret is added. Not covered:
until a build saves its own vault, the list holds the shared vault's names, including one another
build saved that this build cannot decrypt. Settings then shows no "Needs secret", since the view
never decrypts; the Run reports that secret as saved by another OpenWaggle build and asks to save
it again.

Opening Settings > MCP calls `mcp:get-server-statuses` (`McpServerRuntimeService.getServerStatuses`),
which starts no server and sends no request. For each configured server it reports, in order:

1. **`live`**: a Session of the project being viewed (for no project, a Session with none)
   holds an open connection with the same server identity (`mcpServerIdentity`). Connections are
   per Session, so another project's Session connected to the same server, even a global one,
   does not make it connected here: a Session of this project would connect on its own. The
   pool's `connectionStates(identity, projectPath)` reads `ready` and the last error of that
   project's connections without touching recency or handing a connection out; tools are the
   ones the Session's Run listed. Nothing is sent over another Session's lease.
2. **`last-check`**: the in-memory last known state per server identity
   (`adapters/pi/mcp/mcp-server-status-registry.ts`). `inspectServer` ("Check connection",
   `openwaggle mcp list`) records its result, and the connection hooks' `observeResult` records
   every `tools/list` result a Run receives. Tool exposure is applied from the current
   configuration when read. Signing in or out forgets the server's entry. So does a change that
   makes it describe another server (`mcp-server-status-freshness.ts`): each state read notes, per
   project, whether every server is on and its connection fingerprint (vault secrets as their
   stamps), and every saved MCP change re-reads the on/off switches of the projects seen. A
   server turned off or on, or whose connection changed (a secret saved again, say), loses a
   state learned before that was seen; a check made since, such as Check connection after an
   edit, is kept. Nothing is compared while the merge is `incomplete`, since its servers would
   look removed: for both the state read and the change listener, a file that cannot be read;
   for the state read also a file left out after a failed migration (it loads what a Run
   connects with, `loadMcpRuntimeConfig`; the listener reads the files as they are,
   `loadMcpMergedConfig`, so it still sees that file's switches). An invalid entry
   (`rejectedNames`, a `comand` typo, say) leaves that server as last seen and does not stop the
   others being compared.
3. **`not-checked`**: nothing is known; the UI says "Not checked yet". A server that is on but
   reads a vault secret that is not saved is `not-checked` with `needsSecret`, and its row says
   "Needs secret": Runs leave it out, so nothing connected or failed. Saving or deleting a secret
   reads the states again.

`mcp:inspect-server` connects outside any Session and runs only on **Check connection** and in the
CLI's `list`. The state is in memory only, so it starts empty after the Host restarts.

A draining Session Host still answers `mcp:get-configuration`, `mcp:get-server-statuses` and
`mcp:preview-imports` (whose preview skips `migrateBeforeImports` the same way), so
Settings stays usable during an update. While it drains (`isMcpHostDraining`, installed with the
Host's event runtime) they answer from the current files and sign-in store: the configuration
view skips `migrateBeforeEachCall` (a 30 s migration lock, and writes) and the states skip the
sign-in migration (the keychain), so a Settings poll never holds the drain open.

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

The migration has two parts. `migrateOpenWaggleMcpFilesOnce` migrates the files and old
per-Session switches and never touches the keychain; Host start and every MCP file read wait for
it. `migrateOpenWaggleMcpSignInsOnce` also migrates old encrypted sign-ins from the vault, which
reads the keychain through `safeStorage`; the Host starts it once it serves clients
(`startServicesAfterListening`), and a Run's MCP extensions, inspect, sign-in, sign-out, MCP
App connections and Settings' server states (which say whether a server is signed in) wait for
it.

The vault, the old sign-ins' source, uses `safeStorage`'s asynchronous API (Electron 43's
`isAsyncEncryptionAvailable`, `encryptStringAsync`, `decryptStringAsync`), which reads the
keychain off the main thread and opens values the synchronous `encryptString` sealed (same `v10`
format; checked with `--use-mock-keychain`). `resolve` looks the entry up before it asks the
keychain, so a missing secret never touches it. Each of these calls fails after
`MCP_KEYCHAIN_TIMEOUT_MS` (20 s) with "The system keychain did not answer": without a login
keychain, or with a prompt nobody answers, macOS never returns, which hung a Run at "Starting
session", Check connection, and Save in Secrets (round-8 QA). That failure is reported as it is:
`resolve` does not turn it into "saved by another OpenWaggle build" or "cannot be decrypted", and
the first save's takeover fails and records nothing rather than dropping a secret whose
decryption timed out as another build's. The Host's quit hold for SIGTERM or SIGINT ends after
`SESSION_HOST_QUIT_HOLD_MS` (30 s) whatever is still pending.

The sign-in part runs in two queued passes, each under the migration lock: the first migrates the files and asks for the old sign-ins it still
needs (`SIGN_IN_NOT_READ_YET`, not recorded), the vault is read outside the queue and lock, and
the second pass moves them. Once every sign-in is recorded, the first pass asks for none and no
keychain is read. So a slow or prompting keychain leaves the Host responsive, and a files-only
migration (Settings, the catalog, a Run's switch and allowlist reads) never waits behind it.
What reads the sign-in store stays synchronous, because Pi's sign-in store contract is: moving an
old sign-in into `oauth-states.json`, which happens only when there is one to move, every OAuth
server connection, and `mcpSignedIn` in Settings' server states, inspect and sign-in (decrypted
again only when the file changed; cached by mtime). While those wait for the keychain, the Host
is unresponsive. Host stop
(`stopHostServicesAfterListening`) stops the sign-in migration: nothing is written afterwards, and
what it is writing gets `MCP_MIGRATION_STOP_WAIT_MS` (5 s) to finish.

`adapters/mcp/migration/` runs once per file, silently, with one `.pre-adr-0048.bak` backup, and
records what it did in `~/.openwaggle/mcp/migration.json`. A project reached by several
spellings (a symbolic link such as /tmp to /private/tmp, or a Settings path next to a
Session's) is one project (`project-spellings.ts`): records, this process's attempts and its
failures are matched by real location, and the project is migrated under the spelling the old
state.json used for it, the one it names, else the one whose server keys it holds, so its old
switches are found. Real locations resolve the deepest part of a path that exists
(`realLocation`, `realpathSync.native`, so case is the stored one on macOS and Windows), so
two spellings of a project with no `.openwaggle` folder yet agree. Limit: a project file's
backup is found by the spelling it was migrated under (`migrationBackupPath` hashes that path),
so a later legacy read through another spelling (old sign-ins, old server names) reads the
migrated file instead. A recorded file is never migrated
again, so a user's later changes, toggles included, are never undone by the old state. Limit: a
file in the old format restored after its migration (absent at the first launch, or an old copy
brought back by a git pull or a dotfiles checkout) loads as it is, with its servers on, and its
backup keeps the first original. A file behind a link whose target is missing (an unmounted
dotfiles checkout, as the file or one of its folders) is not read as absent: its migration
fails, so it is not loaded, and is tried again; nothing is written through such a link. The
global file's backup sits next to
it; a project file's goes to `~/.openwaggle/mcp/backups/<project>-<hash of its path>/`, never
into the repository, where it could be committed (`migrationBackupPath`). A file the migration
creates (`keepCreatedFileOutOfGit` → `git-exclude.ts`) inside a git work tree gets its path added
to that repository's `.git/info/exclude` (`git rev-parse --git-path info/exclude`, so linked
worktrees use the common one), never `.gitignore` or a tracked file, unless git already ignores
or tracks it. The line is anchored and escapes git's pattern characters (`\ * ? [`, trailing
spaces), and `git check-ignore` confirms it afterwards; otherwise agent turns would report it as a changed file. A backup an earlier
build left next to a project file is still read as the old content. An OpenWaggle file whose migration failed is
not loaded for a Run or an MCP App until a later run migrates it (`migration-health.ts`): it still
has the old format, without the `enabled` overrides that keep old-off servers off. The error is
shown in Settings > MCP and in the Run's MCP notice. That includes a run that could not take the
migration lock within its wait: the files it has not recorded as migrated are gated the same way
(`migration-gate.ts`), except a managed worktree's, which no run migrates. At Host start, after
one such wait the scopes left are gated at once for the usual retry, not waited for in turn.
While old on/off state waits to be applied (OpenWaggle had an MCP setup, or that is not decided
yet), no server of the scope connects at all, fail-closed: the overrides the migration writes
there also keep servers of Pi's files and `.mcp.json` off. Meanwhile writes that could be undone
are refused (`mcp-write-refusal.ts`): Settings, the CLI, imports, and Pi's `/mcp` in a Run (only
in Pi's TUI mode). A write that changes only global files checks the global file, the viewed
project's, and any other project whose old state waits for the migration lock, since that
project's migration would write overrides over it. Another project's failure the user must fix
(an unmounted dotfiles checkout) does not hold global writes back, as it could for good: a project
whose update is waiting keeps its old on/off choices once it is updated. Those waiting projects
are migrated again (`migratePendingKeptProjects`) before a global or everywhere write from
Settings or the CLI and before a global import, awaited; when Settings > MCP opens (`getView`),
started without waiting; and in the background when Pi's `/mcp` change to a global file is
refused, since Pi asks synchronously (one retry at a time, so the next `/mcp` can go through).
Each pass skips the project the call has just migrated, does nothing when the call's own
migration hit a lock timeout (`lastMcpMigrationLockTimeout` changed, whether or not it recorded
a failure), and stops at the first project whose migration waits for the lock again, refusing
with "try again shortly". So one call waits for the lock at most once. The
refusal says "try again shortly" when the migration waited for a lock, and "Fix <file>" when a
file it reads cannot be read; an unreadable state.json or migration.json is named as that file
(`migration-start.ts`). Whether old state waits is decided per file: the global file's when
OpenWaggle had an MCP setup, a project file's when its project keeps its old on/off (undecided
counts as waiting). On a fresh install, or for a project added after the first run, nothing
waits, so nothing is refused. A failed start gates only the files the record does not list as
migrated. A broken state.json is not needed once the decision is made and every old MCP-off
Session switch was carried over (`sessionSwitchesDone`): the run goes on without it, and only a
file still waiting for old state fails. A project folder the old state names that is gone
(deleted, not cloned again yet) is skipped: nothing is created, recorded or gated. The run reports
it (`goneProjects`), and a run for that project is not cached as done, so a folder cloned again
while the Host runs is migrated before it loads: when nothing else failed, the next call runs at
once, without the `MCP_MIGRATION_RETRY_MS` wait. A folder below a
link whose target is missing (an unmounted volume) is not gone: it fails closed. Only an unreadable migration.json fails closed for everything. While a scope
is closed, Check connection fails with the reason instead of "No MCP server named", and a Run
shows one notice per failing file, worded by cause. Unchanged copies of Pi entries are
removed, `directTools` becomes `exposure`/`toolExposure`, and OpenWaggle-only fields are converted
or dropped. It also keeps every server as on or off as it was (`legacy-enablement.ts`): the old
code read only `~/.openwaggle/mcp.json`, `.mcp.json`, and the project's `.openwaggle/mcp.json`, and
connected a server only when MCP was on (project switch, else the global switch, default off), its
state record said `enabled: true`, and it was not muted for the project. Where the new merge would
differ, the migration writes `enabled` into OpenWaggle's global file (a project that inherits
everything) and into each project's file. This covers projects OpenWaggle knew on the first run:
settings, every Session's project and workspace root, and the old state. Projects added later,
and users with no old state and no global file, get the new behaviour. Files are migrated only
in project roots (settings and Sessions' project paths), never in a managed worktree (also when
the old state names one), where a
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
