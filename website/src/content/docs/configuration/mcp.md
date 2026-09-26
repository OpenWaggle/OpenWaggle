---
title: "Model Context Protocol"
description: "Connect external tools and services, review server permissions, and troubleshoot MCP connections."
order: 5
section: "Customize"
---

Model Context Protocol, or MCP, connects the agent to external tools and services. An MCP server might search your issue tracker, read documentation, or expose a local development tool. You do not need MCP for ordinary file editing or terminal commands.

Only connect servers you trust. A server can run a local program or send requests to an external service, and its tools may change data in that service.

## Connect a server

1. Get the server's configuration from its maintainer. Check its command or URL and the access it requests.
2. Open **Settings > MCP**. Select the configuration source you want to edit, using a project source for a project-only server.
3. Add the definition under **Edit selected source**, then click **Save JSON**. See the [configuration example](#configuration-files) below. Do not replace unrelated server entries.
4. Under **Servers**, enable the server. This also trusts its current configuration. OpenWaggle derives its filesystem and network permissions from that definition; there is no separate permission-selection dialog.
5. Under **Activation**, turn on **Global MCP** and check that the intended project and server are enabled. Check any blocked or pending status rather than assuming a switch means the connection is ready.
6. For an OAuth server, use **Authorize / refresh** and complete its sign-in flow.
7. Open **Capabilities** to inspect what the server offers before asking the agent to use it.

Do not choose **Run unsandboxed** merely to dismiss an error. It allows a local server to run with your operating-system user access instead of the required sandbox. Use **Return to sandbox** to reverse that choice.

OpenWaggle includes its MCP connection support. Installing an MCP server does not install an OpenWaggle extension, and you do not need a Pi MCP extension for these steps.

## Activation: global, project, and server

MCP starts globally off. The **Activation** panel has a **Global MCP** switch, project switches, and server switches for the selected project. Disabling an individual server for one project does not disable it for another. Required servers cannot be disabled using the project server switch.

An explicit session setting takes precedence over a project setting, which takes precedence over the global setting. A scope set to inherit follows the next wider setting. Check the effective state for the session you are using; do not rely on the global switch alone to undo explicit project or session overrides.

Per-project server switches also apply to servers inherited from global configuration. A server must still be enabled under **Servers** before a project can use it. Required servers bypass the per-project server switch, not the overall effective MCP setting.

When MCP is effectively off for a session, it receives no MCP connection, local server process, tools, instructions, subscriptions, or derived context. A change made during an active turn can remain pending until the turn finishes.

Turning a server off stops local interaction, but does not prove that work already submitted to a remote service stopped. Remote **Tasks**, jobs a server continues asynchronously, remain visible. A task may require re-enabling the server before you can request cancellation.

## Recommended servers and one-step trust

**Settings > MCP > Recommended servers** lists Playwright MCP and Chrome DevTools MCP. **Install** writes a global definition, enables and trusts it, and turns Global MCP on if it was off. A project explicitly set to off remains off. Installation does not bypass tool-call approvals, missing dependencies, or sandbox requirements.

For other servers, enabling is the trust action. Connection still requires MCP to be on for the current scope. Permissions come from the definition rather than a separate checklist. Package runners such as `npx`, `pnpm`, `uvx`, and `bunx` get outbound network access and read/write access to package-cache directories. Remote endpoints get network access. A plain local command uses the minimal sandbox profile plus any paths and network access requested in its `security` configuration.

Editing an already trusted configuration does not require another trust action. OpenWaggle shows a **Config changed** notice and uses newly derived grants on the next turn. Review changes to commands, endpoints, and `security` fields carefully: they can change what the server can access. Invalid configuration or unavailable sandboxing can still block connection.

## Configuration files

OpenWaggle merges these sources by server name, with later project sources winning:

- `~/.openwaggle/mcp.json`
- `<project>/.mcp.json`
- `<project>/.openwaggle/mcp.json`

Adding a definition alone does not enable it. OpenWaggle stores enablement and trust choices separately under `~/.openwaggle/mcp/`. Plaintext secret-like environment and header values are accepted with a notice, but encrypted vault references are safer.

Use secret references such as `{ "secret": "GITHUB_TOKEN" }` instead of putting credential values in JSON. Add the actual value through the secret controls in Settings. The reference names a stored secret; it is not the secret itself.

Keep secret references in `~/.openwaggle/mcp.json` or `<project>/.openwaggle/mcp.json`, not the shared `<project>/.mcp.json`. Other MCP clients may expect strings and reject `{ "secret": "..." }` objects. OpenWaggle refuses to save these references into the shared file.

If other tools use `.mcp.json`, leave a secret-free entry or `${VAR}` placeholder there. Override the same server name in `.openwaggle/mcp.json` with its OpenWaggle secret references.

This example defines a local documentation server and a remote OAuth service. Replace the command and URL with real values supplied by your server's maintainer:

```json
{
  "mcpServers": {
    "project-docs": {
      "command": "node",
      "args": ["tools/docs-mcp.mjs"],
      "transport": "stdio",
      "security": {
        "readRoots": ["docs"]
      }
    },
    "remote-service": {
      "url": "https://mcp.example.com/mcp",
      "transport": "streamable-http",
      "auth": {
        "type": "oauth",
        "scopes": ["documents:read"]
      }
    }
  }
}
```

`stdio` starts a local executable with the listed arguments. It does not pass the command through a shell. Relative working directories and permission paths resolve against the session's working directory, including its worktree when it has one. `streamable-http` connects to a server over HTTP.

Local servers start with a minimal environment and require sandboxing unless you explicitly approve unsandboxed execution. If sandboxing is unavailable, OpenWaggle shows the risk and blocks the server rather than silently running it without protection.

## Migrating from the Pi MCP adapter

Open **Settings > MCP > Migrate existing MCP configuration** and choose **Scan legacy MCP configs**. The scan is read-only and previews definitions from:

- `~/.config/mcp/mcp.json`
- `~/.pi/agent/mcp.json`
- `<project>/.agents/mcp.json`
- `<project>/.pi/mcp.json`
- `<project>/.openwaggle/agent/mcp.json`
- disabled definitions under `openwaggle.disabledMcpServers` in `<project>/.mcp.json`

Review warnings before importing. OpenWaggle preserves source-path provenance, replaces recognized credential fields with vault references, and enables and trusts imported definitions in the same action. Supply those referenced secrets separately; review commands, arguments, URLs, and warnings for credentials the importer may not recognize. The import does not turn Global MCP on; check **Activation** before expecting a connection. When no servers are configured yet, OpenWaggle scans automatically and offers the import instead of waiting for you to find the button. Existing target definitions win instead of being overwritten. The standard active definitions in `<project>/.mcp.json` already remain available directly and are not duplicated by migration.

When preparing its Pi runtime, OpenWaggle removes only the exact OpenWaggle-owned `extensions/pi-mcp-adapter` package entry from Pi settings. A user-managed `pi-mcp-adapter` npm package remains installed and configured for standalone Pi and other projects, but OpenWaggle does not load it because the desktop app now owns MCP directly. OpenWaggle does not delete unrelated packages or legacy configuration files, so the scan can be rerun while you verify the new definitions.

## When something fails

Check the server's status and error in **Settings > MCP**. OpenWaggle reports the affected server, the likely cause, what to try next, and whether work may still be running remotely.

- Check that the intended project and server are enabled and trusted.
- After editing a command, endpoint, or permission, inspect **Config changed** notices. The server uses new derived grants without another trust dialog.
- Use **Authorize / refresh** for an OAuth connection that needs a new sign-in.
- Use **Refresh** after correcting configuration, or run `openwaggle mcp doctor` for configuration checks.
- Inspect the Event Inbox or remote Task card when work needs attention. Disabling a server is not the same as cancelling a remote job.

## Current and older MCP servers

The rest of this page covers compatibility and automation details. Leave protocol settings at their defaults unless you are diagnosing a server that cannot connect.

Automatic negotiation first probes MCP `2026-07-28`, then conservatively falls back to the supported `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`, and `2024-10-07` initialize handshakes. Stdio and Streamable HTTP use this negotiation automatically. Legacy SSE and WebSocket are explicit compatibility transports.

For diagnosis, set `protocolVersion` to pin one revision or set `compatibility` to `modern-only`, `legacy-stateful-http`, `legacy-sse`, or `legacy-websocket`. A pin fails visibly instead of silently selecting another revision.

Legacy server-initiated sampling is off unless `clientCapabilities.sampling` is `true`, and every request still requires fresh review. Roots are read-only hints, not filesystem grants. Modern and legacy elicitation, logging, notifications, prompts, resources, and tools keep the same OpenWaggle trust and attribution policy.

## Capabilities and context

The agent initially receives only a compact `mcp` gateway; server names, tool schemas, server instructions, and cached catalog entries are not injected. Direct MCP tools are a per-server or per-tool opt-in.

**Settings > MCP > Capabilities** connects when needed:

- Prompts are server-provided message templates. They create editable drafts with the source identified.
- Resources are documents or other content you can inspect before attaching. Treat them as untrusted input.
- Server instructions show their source and are not automatically added to the conversation.
- MCP Apps are interactive server-provided interfaces. They use isolated `ui://` pages with controlled tool access.
- Events go to an opt-in **Event Inbox** instead of automatically starting agent work.
- Remote Tasks remain recorded when you disable a server or restart OpenWaggle.

Remote Skills follow the draft SEP-2640 extension and are off unless the server has `clientCapabilities.remoteSkills: true`. OpenWaggle verifies advertised SHA-256 digests and frontmatter, keeps the server origin visible, requires review before creating a draft, and never executes remote scripts or automatically grants `allowed-tools`. Dynamic Skills without a digest manifest are marked unverifiable and never receive persistent approval.

### Model compatibility

The selected model must support the tool-calling format used by Pi, OpenWaggle's included agent engine. A custom endpoint that accepts text-only chat requests may still fail when sent tools. OpenWaggle does not guess tool support from a model name or silently switch models to compensate.

If a custom provider rejects tool requests, use a compatible model or correct its provider configuration. You can still inspect resources, use prompts, open Apps, and manage servers in Settings.

## Bounded `mcp_run` orchestration

This section is an advanced reference for tool authors and automation. You do not need to write this code to use an MCP server in a conversation.

`mcp_run` lets the agent combine a limited number of MCP calls. Models with ordinary tool calling can use it; provider-native Code Mode is not required. Its preferred `code` input is a small parsed, JavaScript-like language, not JavaScript evaluated by Node.js. The earlier `{ "mode": "sequential|parallel", "calls": [...] }` JSON plan remains accepted for compatibility.

The exact statement forms are:

```js
const query = { term: "MCP" };
const first = await mcp.call("search", "opaque-handle-1", query);

const [docs, issues] = await mcp.parallel([
  mcp.call("docs", "opaque-handle-2", { query: first.result.result }),
  mcp.call("issues", "opaque-handle-3", { query: first.result.result })
]);

if (docs.status === "completed" && issues.status !== "denied") {
  return { docs: docs.result.result, issues: issues.result.result };
} else {
  return { docs: null, issues: null };
}
```

The language supports immutable `const` bindings, sequential calls, bounded parallel groups with matching array destructuring, `if`/`else`, and `return`. Expressions may use JSON literals, arrays, object literals, variable references, own-property `.` reads, parentheses, `!`, `===`, `!==`, `&&`, and `||`. Call ids and opaque handles are non-empty literal strings; call arguments must evaluate to JSON objects. Binding names and child ids are unique across the whole program. `//` and `/* ... */` comments are accepted.

There are no loops, functions, classes, exceptions, mutation, computed properties, general function calls, or ambient globals. The parser rejects syntactic access to `eval`, `Function`, Node.js, Electron, process/environment, shell, filesystem, module/import, timer, prototype, and direct-network authority before execution; those words remain valid as inert string data. Every child is still described, approved, attributed, reported, and audited separately; approving `mcp_run` never approves a child.

Each run is limited to 64,000 source bytes, 120 seconds, 10,000 interpreter steps, 32 child calls, nesting depth 8, 4,000,000 bytes of working memory, 1,000,000 output bytes, and 8 concurrent children. Cancellation or a limit failure stops visibly and never falls back to unrestricted execution. Long-running server work should return an MCP Task.

## CLI

The macOS/Linux installer creates `openwaggle` in `~/.local/bin`. The Windows
installer creates `openwaggle.cmd` beside the installed app and adds that exact
directory to the user `PATH`; open a new terminal after installation so it sees
the updated environment.

Additions are created disabled and untrusted:

```bash
openwaggle mcp add project-docs --scope project -- node tools/docs-mcp.mjs
openwaggle mcp add remote-service --url https://mcp.example.com/mcp --oauth
openwaggle mcp enable project-docs
openwaggle mcp doctor
```

`enable` also trusts the current definition. It does not change the scope's activation setting; use **Settings > MCP > Activation** to turn MCP on. The separate `trust` command remains available, including `trust NAME --allow-unsandboxed` when you have reviewed that risk.

Import is preview-first and supports Codex, Claude's command-line and desktop clients, OpenCode, Pi, VS Code, Cursor, Windsurf, and Zed:

```bash
openwaggle mcp import --from all
openwaggle mcp import --from codex,claude-code,opencode --apply
```

Use `openwaggle mcp registry search|get|add` for Registry entries. Select an official package type when an entry publishes more than one launcher:

```bash
openwaggle mcp registry search filesystem
openwaggle mcp registry get io.github.example/server
openwaggle mcp registry add io.github.example/server --package mcpb
openwaggle mcp registry add io.github.example/server --package oci --scope project
```

Registry additions remain disabled until you review and enable them. Enabling also grants trust. npm, PyPI, and NuGet launchers are saved with exact package versions. OCI tags are pulled and resolved to a Docker-verified `sha256` repository digest, and the saved launcher always executes that digest. MCPB artifacts must be HTTPS GitHub or GitLab release downloads with a declared SHA-256; OpenWaggle downloads them through the private-network-safe HTTP policy, enforces download and extraction bounds, verifies the bytes before extraction, rejects traversal and links, validates the manifest, and atomically caches the launcher by digest. OCI and MCPB Registry entries do not need a separate package `version` field.

Provenance shows the exact package coordinate and shows a digest only after OpenWaggle has verified it. A Registry-declared digest that cannot be reproduced is reported as an integrity failure and no draft is created. Corrupt archives, unsupported manifests or runtime commands, unresolved MCPB user configuration, and incompatible platforms are reported with the action required before retrying. See the [official Registry package semantics](https://modelcontextprotocol.io/registry/package-types) and [MCPB manifest specification](https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md). Secret values are accepted only from piped stdin into configured vault references, never as command arguments.

## OpenWaggle as an MCP server

This advanced option lets another MCP client work with OpenWaggle sessions. It is separate from connecting external servers in Settings and does not start with the desktop app by default.

Choose the exact workspaces or sessions the client may access, then grant only the operations it needs. You can serve over standard input/output or authenticated HTTP on the local machine:

```bash
openwaggle mcp serve --stdio --profile local --grant sessions:discover --workspace /path/to/project
printf '%s' "$OPENWAGGLE_MCP_TOKEN" | openwaggle mcp serve --http 0 --token-stdin --grant sessions:discover --session SESSION_ID
```

Loopback HTTP requires a bearer token of at least 32 bytes, validates Host and Origin, and prints its loopback URL without printing the token. Every caller profile must name at least one `--workspace` or `--session` scope; an empty scope never means every desktop session. Use `--workspace /` only when you intentionally want to grant every project on the machine. Caller profiles separately grant session discovery, reading, creation, messaging, interruption, or organization. A caller cannot inherit desktop approvals or unrestricted access to every session. Hosted callers default to `--authorization-ceiling ask-for-approval`. After reviewing the caller and its scopes, an operator can explicitly use `--authorization-ceiling yolo`; that ceiling permits steering or promoting work into an active Run and allows requested YOLO Run overrides, but only alongside the operation's matching capability grants.

The `openwaggle_sessions` tool exposes the Session Control v2 vocabulary used by the CLI and GUI:

- discovery and reading: `list`, `search`, `read`, `turns`, `items`, and `status`;
- lifecycle and organization: `create`, `launch`, `spawn`, `fork`, `handoff`, `rename`, `archive`, and `unarchive`;
- Run and queue control: `message`, `start`, `follow-up`, `steer`, `promote`, `replace`, `interrupt`, `interrupt-descendants`, `wait`, `queue-list`, `queue-withdraw`, `queue-reorder`, `queue-pause`, `queue-resume`, and `queue-update-authorization`;
- interactions and authorization: `requests-list`, `request-respond`, `approval-respond`, and `authorization-set`;
- reports and Delegations: `report`, `delegation-submit`, `delegation-state`, `delegation-claim`, `delegation-conflict-acknowledge`, `delegation-dependency`, `delegation-propose-amendment`, `delegation-amend`, `delegation-request-revision`, `delegation-accept`, `delegation-reopen`, `delegation-cancel`, `delegation-verify`, `delegations-list`, `delegations-read`, and `delegations-conflicts`;
- exports: `export`, `export-create`, `export-cancel`, `exports-list`, `exports-read`, and `exports-wait`.

Use the lifecycle operation's `workspace` field to choose `current`, `local`, `existing`, `new-worktree`, `share-parent`, or `share-source` where that operation permits it. Worktree-backed lifecycle operations require the corresponding creation and organization grants. MCP does not expose the GUI-only pin order, a separate worktree planning/materialization protocol, or a `clone` operation.

For `create`, `launch`, `fork`, `spawn`, and `handoff`, set `workspace: "new-worktree"` and `startFromOrigin: true` to resolve the new Worktree from the configured origin remote. `baseRef` and `startFromOrigin` are rejected for other Workspace modes. A `spawn` Delegation accepts `resourceReferences` for files or context the Worker should use; `exportResources` is a separate `export-create` field and never becomes Worker context. Supplying either resource field to another operation is rejected rather than ignored.

`launch` and `spawn` accept `yolo: true` for a per-Run override. `start`, `follow-up`, and `replace` accept either `yolo: true` or `runAuthorizationOverride`; the server must have been started with `--authorization-ceiling yolo`, and the caller must hold the operation's matching capability grants. `steer` and `promote` also require that reviewed YOLO ceiling because they inject work into an active Run. `promote` requires `sessionId`, `followUpId`, and `expectedRunId`, and fails rather than steering a different Run when that Run id is stale.

`search` accepts `message`, optional `searchMode`, and `fullTranscript`. Discovery search defaults to hybrid mode; `fullTranscript: true` defaults to lexical mode and requires transcript-read authority. Explicit semantic or hybrid full-transcript searches use the bounded, authorized lazy transcript projection described in the Sessions CLI guide. Single-term and quoted transcript matches include node, Run when known, and durable-order attribution; unquoted multi-term matches may aggregate evidence across several items and therefore omit a misleading single-node attribution.

The public tool input is strict: unknown fields, including unknown fields inside interaction responses, Delegation specifications, evidence, and claims, are rejected. This makes misspelled controls fail visibly instead of being silently ignored.

The public envelope is bounded before any operation runs. Session and Delegation ids accept up to 512 characters, titles accept 1–512 characters and must contain a non-whitespace character, top-level messages and objectives accept up to 131,072, and individual list items accept up to 16,384. Repeated task fields, resource references, and evidence accept at most 256 entries; custom JSON responses accept at most 131,072 serialized characters. Discovery operations accept a maximum `limit` of 200, while transcript item reads accept up to 500. Transcript, Delegation history, export, and export-operation responses may return fewer records when the encoded-byte page budget is reached; continue from the returned cursor. A single record beyond that budget returns `record_too_large`.

Foreground `export` continuation is snapshot-bound. When a page returns `nextCreatedOrder`, call `export` again with that value as `afterCreatedOrder` and copy the first page's complete `manifest` into `snapshotManifest`. Do not reconstruct or edit the manifest: the strict schema uses it to keep the Session, branch, queue-body scope, high-water mark, and captured state immutable. Transcript items appended after page one are excluded from that export. If an existing snapshot node is edited or removed between pages, continuation returns `resync_required` instead of mixing node versions; restart the export from page one. Durable `export-create` operations paginate internally and do not need this client loop.

Successful calls return the canonical local result in both MCP forms: JSON text in `content` and the same object in `structuredContent`. The object contains `contract` (`session-query-v2`, `session-control-v2`, or `session-lifecycle-v2`) and `response`; inspect `response.outcome` for the operation-specific result, cursor, or idempotency metadata. Canonical query errors and rejected mutations are returned as MCP tool errors rather than successful payloads. OpenWaggle revalidates every grant and Session or Workspace scope on each call.

`interrupt` targets the active Run using `sessionId` and `expectedRunId`. Inspect the returned outcome, then use `status` or `wait` to confirm the session is idle. The current `interrupt` input does not accept `timeoutMs`; `wait` is the operation for bounded waiting. `steer` adds input to an active Run without replacing it; use `replace` when you intend to interrupt and start different work.
