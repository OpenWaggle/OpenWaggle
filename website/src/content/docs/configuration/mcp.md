---
title: "Model Context Protocol"
description: "Connect external tools and services to the agent with MCP servers, using the same configuration as Pi."
order: 5
section: "Customize"
---

Model Context Protocol, or MCP, connects the agent to external tools and services. An MCP server might search your issue tracker, read documentation, or drive a browser. You do not need MCP for ordinary file editing or terminal commands.

OpenWaggle runs MCP the way the Pi coding agent does. A server you set up for Pi works in OpenWaggle without changes, with the same names, settings, and sign-ins. That includes `${NAME}` values: OpenWaggle reads them from your login shell's environment, as a `pi` command started in a terminal would, even when the app was opened from the Dock or Start menu.

Only add servers you trust. A server can run a program on your computer or send requests to an outside service, and its tools may change data there. Adding a project to OpenWaggle trusts the servers that project configures.

## Add a server

1. Open **Settings > MCP** and choose **Add server**.
2. Give it a name (letters, digits, `-`, and `_`). The name must not be in use in any of the five files below. Names that differ only in `-` and `_`, such as `my-docs` and `my_docs`, count as the same name, because their tools would share one name.
3. For a local server, enter the command and its arguments, for example `npx` with `-y @modelcontextprotocol/server-filesystem .`. For a remote server, enter its URL.
4. Choose where to save it. New servers go to OpenWaggle's file for that scope: `~/.openwaggle/mcp.json` for all projects, or `.openwaggle/mcp.json` in the project. You can pick a Pi file instead if you also use the `pi` command. A server for all projects goes to a global file, and a project's server to a project file. Sign-in through a model provider (`auth`) only works in a global file.

The server connects the next time you send a message. **Recommended servers** installs Playwright MCP or Chrome DevTools MCP in one click.

### From the MCP Registry

The [MCP Registry](https://registry.modelcontextprotocol.io) lists published servers. Under **MCP Registry** in **Settings > MCP**, search by name, pick **All projects** or **This project**, and choose **Install**. When a server can run more than one way, for example as a hosted server at a URL or from an npm package, pick one first.

Installing adds an ordinary entry to OpenWaggle's file, so the server then works like any other. A few details:

- Packages are pinned to the exact version the Registry lists. Docker images are pinned to the image Docker downloaded.
- MCP bundles (`.mcpb`) are downloaded, checked against the checksum the Registry publishes, and unpacked under `~/.openwaggle/mcp/registry-cache`. A bundle that fails the check installs nothing.
- If the server needs an API key or token, the entry refers to a secret by name (see [Secrets](#secrets)). OpenWaggle tells you which ones to add; the server does not start until they exist.

To bring servers over from another app, choose **Import**. OpenWaggle reads Codex, Claude's desktop and command-line apps, Cursor, VS Code, OpenCode, Zed, and Windsurf, shows what it found, and adds the servers you pick to OpenWaggle's file. Servers you configured for Pi do not need importing; OpenWaggle reads Pi's files directly.

Imported values keep the meaning they had in the other app. Variables that app fills in, such as `${env:NAME}` in Cursor, VS Code, and Windsurf, `{env:NAME}` in OpenCode, or `${NAME}` in Claude's command-line app, become `${NAME}` in `env`, `headers`, and an OAuth client secret, the places Pi fills variables in. Elsewhere, such as in arguments, a value is kept as written and the import warns that Pi does not expand it there. Any other `$` or leading `!` is kept as plain text, so an imported value never runs a command. Passwords and tokens written out in the other app are not copied: OpenWaggle names a secret for you to add instead.

## Where servers are configured

OpenWaggle reads five files, in this order:

| File | Used for |
| --- | --- |
| `~/.pi/agent/mcp.json` | Pi's servers for all projects |
| `~/.openwaggle/mcp.json` | OpenWaggle's servers for all projects |
| `<project>/.mcp.json` | Servers the project shares with other tools |
| `<project>/.pi/mcp.json` | Pi's servers for the project |
| `<project>/.openwaggle/mcp.json` | OpenWaggle's servers for the project |

When two files define a server with the same name, the project file wins over the global one, and a later file wins over an earlier one.

Pi's global file moves with Pi's agent folder: if you set `PI_CODING_AGENT_DIR`, OpenWaggle reads `mcp.json` there. If a project is your home folder, its `.openwaggle/mcp.json` is the global `~/.openwaggle/mcp.json`; OpenWaggle reads it once, as the global file, and a switch for that project only is not available, since it would change every project. If a file is a symbolic link, for example into a dotfiles repository, OpenWaggle saves changes to the file the link points to and leaves the link in place.

Every file uses the same format:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    },
    "docs": {
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer ${DOCS_TOKEN}" },
      "description": "Search and read the product documentation"
    }
  }
}
```

- `command` is one program and `args` its arguments. It is not run through a shell.
- `env` sets environment variables for a local server; `cwd` sets its working folder.
- `url` connects to a remote server over HTTP. Older servers that only offer Server-Sent Events need `"type": "sse"`; WebSocket servers use a `ws://` or `wss://` URL.
- `${NAME}` or `$NAME` in `env`, `headers`, or an OAuth client secret uses an environment variable from your login shell, and a value starting with `!` runs a command, as in Pi. Write `$$` for a literal `$`. `url`, `command`, and `args` are used as written; Pi does not fill variables in there.
- If a value cannot be filled in, for example a missing variable or secret, that server reports the error and the others still connect.
- `enabled: false` keeps a server without connecting to it.
- `timeout` is how long a request may take, in seconds (default 60).

An entry with only `enabled`, `exposure`, or `toolExposure` changes a server defined in an earlier file and keeps the rest of it. For example, this in `.openwaggle/mcp.json` turns a global server off in one project:

```json
{
  "mcpServers": {
    "internal-tools": { "enabled": false }
  }
}
```

### Secrets

In OpenWaggle's own files you can store a value in OpenWaggle's encrypted secret store instead of writing it in the file. Add the secret under **Settings > MCP > Secrets**, then refer to it by name:

```json
{
  "mcpServers": {
    "github": {
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": { "Authorization": { "secret": "github-token" } }
    }
  }
}
```

Secret references only work in `~/.openwaggle/mcp.json` and `.openwaggle/mcp.json`, because Pi and other tools read the other files and do not understand them.

## Change a server

Select a server in **Settings > MCP** to see where it is defined, whether it is connected, its tools, and any error, including the last lines a local server printed. From there you can:

- turn it on or off everywhere, or only in this project with **Turn off in this project** or **Turn on in this project**;
- choose how its tools reach the agent (see below), for the whole server or tool by tool;
- sign in or sign out;
- remove it.

A change to an existing server is saved to the file that defines it. Turning a global server on or off for one project is saved in that project, never in a global file. If the project already changes that server in one of its files, for example with an entry in `.pi/mcp.json`, that entry is updated. Otherwise the change goes to `.openwaggle/mcp.json`.

To keep one Session away from every MCP server, open the composer's **+** menu and clear **Use MCP servers**. That Session's Runs start no MCP servers, and the ones it had open close. Every Session uses MCP servers until you do this, and the change touches no file.

Removing a server also removes the entries in OpenWaggle's files that only changed it. Entries like that in Pi's files or in `.mcp.json` are left as they are and listed as errors, so you can remove them yourself.

### After upgrading from an older OpenWaggle

The first time a new version starts, OpenWaggle converts its older MCP files to the format above and keeps a copy of each file it changes, ending in `.pre-adr-0048.bak`. Servers stay on or off as they were:

- If MCP was off in OpenWaggle, every server is turned off.
- Otherwise, servers that connected before stay on, and the others are turned off.
- This applies to every project OpenWaggle knew about when it upgraded. Projects added later, and people who never set up MCP in OpenWaggle, start with servers on as their files say.
- A Session you had switched MCP off for stays off. Turn it back on from **Use MCP servers** in the composer's **+** menu.
- A project that is your home folder shares its OpenWaggle file with every project, so servers you had switched on or off for that project only are not carried over. Switch them again in that project if you need to.

Copies OpenWaggle made of your Pi servers are removed when they still match Pi's entry, so the server is defined once; a setting you changed in OpenWaggle, such as direct tools, stays as an entry that changes Pi's server. A copy you edited, or one that reads a secret from the encrypted store, is kept.

## How tools reach the agent

Each server's **exposure** decides how the agent can use its tools. Tool names look like `mcp__<server>__<tool>`.

| Exposure | What the agent sees |
| --- | --- |
| Codemode (default) | The agent finds and calls the tools from short scripts, so many tools cost little context. |
| Deferred | The agent searches for the tools it needs, then calls them directly. |
| Direct | The tools are offered to the agent from the start, like built-in tools. Best for small, frequently used servers. |
| Hidden | The tools cannot be used. |

You can give single tools their own exposure, for example to offer one search tool directly and hide a delete tool.

Every MCP tool call, including calls made from a script, asks for your approval in **Ask for approval** mode. **Allow** choices are remembered per server and tool.

## Sign in

Remote servers that use OAuth, such as Sentry or Figma, need no credentials in the file. When one needs sign-in, its row in **Settings > MCP** says so; choose **Sign in** and finish in your browser. Sign-ins are stored in OpenWaggle's encrypted store. A server you already signed in to with the `pi` command is signed in in OpenWaggle too. Signing out in OpenWaggle does not change Pi's sign-in file.

A server that a Pi extension adds signs in the same way, when a Run first uses it: the sign-in page opens in your browser. Such servers are not in **Settings > MCP**, so they cannot be signed in from there.

OAuth options such as a registered client id, a fixed callback port, or scopes go under `oauth`, as described in Pi's MCP documentation.

## Connections

A server connects in the background when a session sends a message, and only servers with direct tools can delay a message, by at most 1.5 seconds. The connection stays open for that session's later messages, so a server keeps its state through a conversation. Each session has its own connections; a Worker or a fork starts its own.

Opening **Settings > MCP** starts no server. Each server shows what is already known: the state of a session that is connected to it, otherwise the result of the last check, otherwise **Not checked yet**. Choose **Check connection** on a server to connect to it, list its tools, and disconnect; `openwaggle mcp list` checks every enabled server the same way.

A session's servers stop after 5 minutes without a new message, when the session is archived or deleted, and when OpenWaggle's background Host stops. When many sessions have servers running, the one used least recently stops first. Stopping a local server also stops any program it was started through, such as `npx` or `uvx`.

## Apps, sampling, and input requests

- **MCP Apps** are small interactive pages a server attaches to a tool result. They appear under the tool call in the conversation and run isolated from OpenWaggle.
- **Sampling** lets a server ask your model to write something. OpenWaggle asks for your approval and never shares the conversation.
- **Input requests** (elicitation) let a server ask you for information, in a form or on a web page the server names.

## When something fails

Open **Settings > MCP** and select the server. Its error and the last lines it printed usually say what is wrong: a missing program, a wrong URL, or a sign-in that expired. Fix the configuration, then choose **Check connection**.

Files that cannot be read and entries that are not valid are listed at the top of **Settings > MCP**; other servers keep working.

`openwaggle mcp doctor` prints the same in a terminal: which of the five files exist, the errors found in them, and each server's state with the last lines it printed. It connects to every enabled server to check it. Add `--local` to include the current project's files, or `--json` for a machine-readable report.

MCP versions from `2024-11-05` to `2025-11-25` are supported. Servers that only speak a newer or older version cannot connect yet.

## Command line

The macOS/Linux installer creates `openwaggle` in `~/.local/bin`. The Windows installer creates `openwaggle.cmd` beside the installed app and adds that directory to your `PATH`; open a new terminal after installing.

```bash
openwaggle mcp list
openwaggle mcp add filesystem -- npx -y @modelcontextprotocol/server-filesystem .
openwaggle mcp add docs --url https://example.com/mcp
openwaggle mcp add --local tools -- uvx tools-mcp
openwaggle mcp disable docs
openwaggle mcp login sentry
openwaggle mcp import --from codex,cursor
openwaggle mcp import --from codex,cursor --apply
openwaggle mcp registry search weather
openwaggle mcp registry add io.github.example/weather
openwaggle mcp registry add --local io.github.example/weather --package npm --name forecast
openwaggle mcp doctor --local
```

New servers go to `~/.openwaggle/mcp.json`, or to `.openwaggle/mcp.json` in the current project with `--local`. The project must already be open in OpenWaggle. `mcp import` lists what it found; add `--apply` to import it. `mcp registry add` connects to the server's hosted URL when it has one; `--package npm`, `pypi`, `nuget`, `oci`, or `mcpb` picks a package instead, and `--name` changes the name it gets.

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
- Run and queue control: `message`, `start`, `follow-up`, `steer`, `promote`, `replace`, `interrupt`, `interrupt-descendants`, `wait`, `queue-list`, `queue-withdraw`, `queue-reorder`, `queue-pause`, and `queue-resume`;
- interactions and authorization: `requests-list`, `request-respond`, `approval-respond`, and `authorization-set`;
- reports and Delegations: `report`, `delegation-submit`, `delegation-state`, `delegation-claim`, `delegation-conflict-acknowledge`, `delegation-dependency`, `delegation-propose-amendment`, `delegation-amend`, `delegation-request-revision`, `delegation-accept`, `delegation-reopen`, `delegation-cancel`, `delegation-verify`, `delegations-list`, `delegations-read`, and `delegations-conflicts`;
- exports: `export`, `export-create`, `export-cancel`, `exports-list`, `exports-read`, and `exports-wait`.

Use the lifecycle operation's `workspace` field to choose `current`, `local`, `existing`, `new-worktree`, `share-parent`, or `share-source` where that operation permits it. Worktree-backed lifecycle operations require the corresponding creation and organization grants. MCP does not expose the GUI-only pin order, a separate worktree planning/materialization protocol, or a `clone` operation.

For `create`, `launch`, `fork`, `spawn`, and `handoff`, set `workspace: "new-worktree"` and `startFromOrigin: true` to resolve the new Worktree from the configured origin remote. `baseRef` and `startFromOrigin` are rejected for other Workspace modes. A `spawn` Delegation accepts `resourceReferences` for files or context the Worker should use; `exportResources` is a separate `export-create` field and never becomes Worker context. Supplying either resource field to another operation is rejected rather than ignored.

`launch` and `spawn` accept `yolo: true` for a per-Run override and `thinking` for the new Session's starting thinking level. `message` and `start` accept `thinking` and either `yolo: true` or `runAuthorizationOverride` only when they start a Run on an idle Session. `thinking` becomes the Session's thinking level; the override applies to that one Run. A `message` that would be queued behind an active Run is refused with `thinking_level_requires_idle_session` or `run_authorization_override_requires_idle_session`, and `follow-up` and `replace` do not accept either field. A YOLO override requires a server started with `--authorization-ceiling yolo`, and the caller must hold the operation's matching capability grants. `steer` and `promote` also require that reviewed YOLO ceiling because they inject work into an active Run. `promote` requires `sessionId`, `followUpId`, and `expectedRunId`, and fails rather than steering a different Run when that Run id is stale.

`search` accepts `message`, optional `searchMode`, and `fullTranscript`. Discovery search defaults to hybrid mode; `fullTranscript: true` defaults to lexical mode and requires transcript-read authority. Explicit semantic or hybrid full-transcript searches use the bounded, authorized lazy transcript projection described in the Sessions CLI guide. Single-term and quoted transcript matches include node, Run when known, and durable-order attribution; unquoted multi-term matches may aggregate evidence across several items and therefore omit a misleading single-node attribution.

The public tool input is strict: unknown fields, including unknown fields inside interaction responses, Delegation specifications, evidence, and claims, are rejected. This makes misspelled controls fail visibly instead of being silently ignored.

The public envelope is bounded before any operation runs. Session and Delegation ids accept up to 512 characters, titles accept 1–512 characters and must contain a non-whitespace character, top-level messages and objectives accept up to 131,072, and individual list items accept up to 16,384. Repeated task fields, resource references, and evidence accept at most 256 entries; custom JSON responses accept at most 131,072 serialized characters. Discovery operations accept a maximum `limit` of 200, while transcript item reads accept up to 500. Transcript, Delegation history, export, and export-operation responses may return fewer records when the encoded-byte page budget is reached; continue from the returned cursor. A single record beyond that budget returns `record_too_large`.

Foreground `export` continuation is snapshot-bound. When a page returns `nextCreatedOrder`, call `export` again with that value as `afterCreatedOrder` and copy the first page's complete `manifest` into `snapshotManifest`. Do not reconstruct or edit the manifest: the strict schema uses it to keep the Session, branch, queue-body scope, high-water mark, and captured state immutable. Transcript items appended after page one are excluded from that export. If an existing snapshot node is edited or removed between pages, continuation returns `resync_required` instead of mixing node versions; restart the export from page one. Durable `export-create` operations paginate internally and do not need this client loop.

Successful calls return the canonical local result in both MCP forms: JSON text in `content` and the same object in `structuredContent`. The object contains `contract` (`session-query-v2`, `session-control-v2`, or `session-lifecycle-v2`) and `response`; inspect `response.outcome` for the operation-specific result, cursor, or idempotency metadata. Canonical query errors and rejected mutations are returned as MCP tool errors rather than successful payloads. OpenWaggle revalidates every grant and Session or Workspace scope on each call.

`interrupt` targets the active Run using `sessionId` and `expectedRunId`. Inspect the returned outcome, then use `status` or `wait` to confirm the session is idle. The current `interrupt` input does not accept `timeoutMs`; `wait` is the operation for bounded waiting. `steer` adds input to an active Run without replacing it; use `replace` when you intend to interrupt and start different work.
