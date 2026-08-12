---
title: "Model Context Protocol"
description: "Configure, scope, trust, diagnose, and use OpenWaggle's first-party MCP integration."
order: 3
section: "Configuration"
---

OpenWaggle has a first-party Model Context Protocol client and an optional OpenWaggle MCP server. MCP is not a Pi extension, and installing an MCP server never installs an OpenWaggle extension.

## Activation: global, project, and server

MCP starts globally off. **Settings → MCP → Activation** exposes three switches:

- **Global** is the master switch. When it is off, nothing connects or enters agent context anywhere, regardless of any project or server setting.
- **Per project** turns MCP on or off for one project. A project follows Global until you turn it off, which disables MCP for that project only and never affects other projects. The Activation panel lists your known projects so you can toggle any of them.
- **Per server, per project** enables or disables each individual server for the selected project — including servers inherited from your global config. Disabling a server for one project leaves it running in every other project; the override is stored per project (keyed by project path) and cannot leak between projects. Required servers always run and cannot be disabled this way.

Effective state still resolves session → project → global underneath, so a session can override a project and a project can override global; the Activation UI presents this as plain on/off.

Off means no server connection, local process, MCP tool, server instruction, subscription, or MCP-derived context for that scope. Changes made during a running turn are shown as pending and apply at the next safe turn boundary. Disabling a server stops local interaction but cannot prove that remote work stopped; durable remote Tasks stay visible and say when re-enabling is required to request cancellation.

## Configuration files

OpenWaggle merges these sources by server name, with later project sources winning:

- `~/.openwaggle/mcp.json`
- `<project>/.mcp.json`
- `<project>/.openwaggle/mcp.json`

Project config may request a server but cannot enable or trust it. User-owned state is stored separately under `~/.openwaggle/mcp/`. Credentials use vault references such as `{ "secret": "GITHUB_TOKEN" }`; never put secret values in JSON.

Keep secret references in an OpenWaggle-owned file — `~/.openwaggle/mcp.json` or `<project>/.openwaggle/mcp.json` — not in the shared `<project>/.mcp.json`. The standard `.mcp.json` is also read by other MCP tools (for example Pi's own MCP adapter) that expect plain string values and crash on a `{ "secret": … }` object, so OpenWaggle refuses to save a secret reference into `.mcp.json` and points you to `.openwaggle/mcp.json` instead. Because project sources merge by name with `.openwaggle/mcp.json` winning, you can leave a plain, secret-free (or `${VAR}`) entry in `.mcp.json` for other tools and override it with the secret-bearing definition in `.openwaggle/mcp.json`.

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

Local commands are an executable plus an argument array and never pass through a shell. Project paths are project-relative. Local servers start sandboxed with a minimal environment; unsupported sandboxing or a request for unsandboxed execution is shown as a blocking risk, not silently accepted.

## Migrating from the Pi MCP adapter

Open **Settings → MCP → Migrate existing MCP configuration** and choose **Scan legacy MCP configs**. The scan is read-only and previews definitions from:

- `~/.config/mcp/mcp.json`
- `~/.pi/agent/mcp.json`
- `<project>/.agents/mcp.json`
- `<project>/.pi/mcp.json`
- `<project>/.openwaggle/agent/mcp.json`
- disabled definitions under `openwaggle.disabledMcpServers` in `<project>/.mcp.json`

Review warnings before importing. OpenWaggle preserves source-path provenance, does not copy plaintext credentials, and imports every selected definition disabled and untrusted. Existing target definitions win instead of being overwritten. The standard active definitions in `<project>/.mcp.json` already remain available directly and are not duplicated by migration.

The migration removes only the exact OpenWaggle-owned `extensions/pi-mcp-adapter` entry from Pi settings. It does not remove unrelated packages or delete legacy configuration files, so the scan can be rerun while you verify the new definitions.

## Current and older MCP servers

Automatic negotiation first probes MCP `2026-07-28`, then conservatively falls back to the supported `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`, and `2024-10-07` initialize handshakes. Stdio and Streamable HTTP use this negotiation automatically. Legacy SSE and WebSocket are explicit compatibility transports.

For diagnosis, set `protocolVersion` to pin one revision or set `compatibility` to `modern-only`, `legacy-stateful-http`, `legacy-sse`, or `legacy-websocket`. A pin fails visibly instead of silently selecting another revision.

Legacy server-initiated sampling is off unless `clientCapabilities.sampling` is `true`, and every request still requires fresh review. Roots are read-only hints, not filesystem grants. Modern and legacy elicitation, logging, notifications, prompts, resources, and tools keep the same OpenWaggle trust and attribution policy.

## Capabilities and context

The agent initially receives only a compact `mcp` gateway; server names, tool schemas, server instructions, and cached catalog entries are not injected. Direct MCP tools are a per-server or per-tool opt-in.

Settings → MCP → Capabilities connects lazily:

- Prompts create attributed editable drafts.
- Resources are inspected before attachment and remain untrusted.
- Server instructions are bounded, attributed, and never injected automatically.
- MCP Apps render `ui://` content in an isolated host and use brokered tool calls.
- Events enter an opt-in Event Inbox instead of starting agent work automatically.
- Remote Tasks remain durable and transparent across disable/restart boundaries.

Remote Skills follow the draft SEP-2640 extension and are off unless the server has `clientCapabilities.remoteSkills: true`. OpenWaggle verifies advertised SHA-256 digests and frontmatter, keeps the server origin visible, requires review before creating a draft, and never executes remote scripts or automatically grants `allowed-tools`. Dynamic Skills without a digest manifest are marked unverifiable and never receive persistent approval.

### Model compatibility

Pi's model registry contains tool-capable chat models. Its current `Model` contract has no separate tool-support flag or model-name probe, so OpenWaggle treats successful Pi registry resolution as the capability gate and does not guess from provider or model names. This applies to built-in and custom provider models.

A custom provider that registers a Pi model promises to accept Pi's tool context and emit Pi tool-call events. If it violates that contract, the run fails visibly instead of silently dropping MCP tools or switching models. Switch to a conforming model or fix the custom provider. You can still use Settings to invoke MCP prompts, inspect or attach resources, open Apps, and manage servers.

## Bounded `mcp_run` orchestration

Models with ordinary tool calling can use `mcp_run`; provider-native Code Mode is not required. Its preferred `code` input is a small parsed, JavaScript-like language, not JavaScript evaluated by Node.js. The earlier `{ "mode": "sequential|parallel", "calls": [...] }` JSON plan remains accepted for compatibility.

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
openwaggle mcp trust project-docs
openwaggle mcp doctor
```

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

Registry additions remain disabled and untrusted until you review and trust them. npm, PyPI, and NuGet launchers are saved with exact package versions. OCI tags are pulled and resolved to a Docker-verified `sha256` repository digest, and the saved launcher always executes that digest. MCPB artifacts must be HTTPS GitHub or GitLab release downloads with a declared SHA-256; OpenWaggle downloads them through the private-network-safe HTTP policy, enforces download and extraction bounds, verifies the bytes before extraction, rejects traversal and links, validates the manifest, and atomically caches the launcher by digest. OCI and MCPB Registry entries do not need a separate package `version` field.

Provenance shows the exact package coordinate and shows a digest only after OpenWaggle has verified it. A Registry-declared digest that cannot be reproduced is reported as an integrity failure and no draft is created. Corrupt archives, unsupported manifests or runtime commands, unresolved MCPB user configuration, and incompatible platforms are reported with the action required before retrying. See the [official Registry package semantics](https://modelcontextprotocol.io/registry/package-types) and [MCPB manifest specification](https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md). Secret values are accepted only from piped stdin into configured vault references, never as command arguments.

## OpenWaggle as an MCP server

Server mode never starts with the desktop app by default. Stdio and authenticated loopback Streamable HTTP both serve current and older MCP clients from the same capability factory:

```bash
openwaggle mcp serve --stdio --profile local --grant sessions:discover --workspace /path/to/project
printf '%s' "$OPENWAGGLE_MCP_TOKEN" | openwaggle mcp serve --http 0 --token-stdin --grant sessions:discover --session SESSION_ID
```

Loopback HTTP requires a bearer token of at least 32 bytes, validates Host and Origin, and prints its loopback URL without printing the token. Every caller profile must name at least one `--workspace` or `--session` scope; an empty scope never means every desktop session. Use `--workspace /` only when you intentionally want to grant every project on the machine. Caller profiles separately grant session discovery, reading, creation, messaging, interruption, or organization. A caller cannot inherit desktop approvals or unrestricted access to every session.

The `openwaggle_sessions` tool supports discovery, status, paginated reading, creation, worktree planning/materialization, fork/clone, message/steer, wait/interrupt, handoff, rename, pin/unpin, and archive/unarchive. Worktree creation requires both `sessions:create` and `sessions:organize`. It leaves the source session unchanged and returns a new derived session rooted at a deterministic Git worktree; the response includes both session IDs, the path, branch, base ref, and delegation depth. Later messages and tasks sent to the derived session execute in that worktree. OpenWaggle revalidates its source-session grant and Git provenance on every access, and refuses changed plans, replaced paths, branches, or repositories instead of silently falling back to the source checkout.

## When something fails

OpenWaggle reports the affected server, impact, cause, responsible side, next action, and whether work may still be running remotely. Use Refresh after correcting config, `openwaggle mcp doctor` for static checks, and the Event Inbox or durable Task card for state that needs inspection. Trust is invalidated when the executable, endpoint, package fingerprint, requested capabilities, security profile, or effective config changes.
