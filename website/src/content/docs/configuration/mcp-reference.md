---
title: "MCP reference"
description: "MCP server entry fields, transports, exposure values, import rules, openwaggle mcp commands, and the OpenWaggle MCP server's operations and limits."
section: "Reference"
kind: "reference"
---

This page lists the exact values for MCP in OpenWaggle. To connect a server, approve its tools, or fix a failing one, start with the [Model Context Protocol](/docs/configuration/mcp) guide.

## Server entries

Each key under `mcpServers` in an MCP file is a server name: letters, digits, `-`, and `_`. Its value is an entry with these fields.

| Field | Type | Default | What it does |
| --- | --- | --- | --- |
| `command` | string | None | The program a local (stdio) server runs. Not run through a shell. |
| `args` | string list | None | The program's arguments. |
| `env` | object | None | Environment variables for a local server. |
| `cwd` | string | None | A local server's working folder. |
| `url` | string | None | A remote server's address. `ws://` or `wss://` connects over WebSocket. |
| `type` | `"sse"`, `"websocket"` | From `url` | `"sse"` for an older server that only offers Server-Sent Events. |
| `headers` | object | None | HTTP headers for a remote server. |
| `oauth` | object | None | OAuth sign-in options: `clientId`, `clientSecret`, `callbackPort`, `callbackUrl`, `scope`, `clientName`, `clientRegistration`, `authServerMetadataUrl`. See Pi's MCP documentation. |
| `auth` | `{ "provider": "<id>" }` | None | Sign in through a model provider. Works only in a global file. |
| `description` | string | None | What the server offers, shown in Settings and to the agent. |
| `enabled` | boolean | `true` | `false` keeps the server without connecting to it. |
| `exposure` | string | `"codemode"` | How the server's tools reach the agent. See [Exposure values](#exposure-values). |
| `toolExposure` | object | None | Exposure for single tools, by tool name. A name with `*` matches several tools. |
| `timeout` | number | `60` | How long one request may take, in seconds. |

An entry with only `enabled`, `exposure`, or `toolExposure`, and no `command`, `url`, or `type`, changes the server with that name from an earlier file and keeps the rest of it.

OpenWaggle's two files, `~/.openwaggle/mcp.json` and `<project>/.openwaggle/mcp.json`, can hold three things Pi's files and `.mcp.json` cannot: SSE servers, WebSocket servers, and secret references. OpenWaggle never saves those to Pi's files or to `.mcp.json`.

OpenWaggle's two files also have a JSON Schema, [`mcp.schema.json`](https://openwaggle.ai/schemas/mcp.schema.json). OpenWaggle keeps a `"$schema"` key when it changes the file:

```json
{
  "$schema": "https://openwaggle.ai/schemas/mcp.schema.json",
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    }
  }
}
```

Do not point Pi's files or `.mcp.json` at this schema. It accepts secret references and SSE and WebSocket servers, which only OpenWaggle's files can hold.

## Values and variables

| Where | Written as | Result |
| --- | --- | --- |
| `env`, `headers`, OAuth `clientSecret` | `${NAME}` or `$NAME` | The variable from your login shell's environment. |
| `env`, `headers`, OAuth `clientSecret` | A value starting with `!` | Runs the rest as a command and uses its output, as in Pi. |
| `env`, `headers`, OAuth `clientSecret` | `$$` | A literal `$`. |
| `env`, `headers` in OpenWaggle's files | `{ "secret": "<name>" }` | The whole value, from OpenWaggle's encrypted secret store. |
| `url`, `command`, `args`, `cwd` | Anything | Used as written. Pi fills in no variables there. |

A value that cannot be filled in, for example a missing variable or secret, fails only that server. The others still connect. OpenWaggle leaves a server that reads a secret you have not saved out of sessions until you add the secret.

## Exposure values

Tool names look like `mcp__<server>__<tool>`, with `-` in the server name replaced by `_`.

| Value | Shown in Settings | What the agent gets |
| --- | --- | --- |
| `codemode` | **Codemode** | The default. The agent finds the tools and calls them from codemode scripts. Tools that open an MCP App go to the agent directly. |
| `hidden` | **Hidden** | The agent cannot use the tools. |
| `direct` | **Codemode** | Runs as `codemode`. OpenWaggle leaves the file alone, so the `pi` command still offers these tools directly. |
| `deferred` | While a file sets it | The agent searches for the tools, then calls them directly. |
| `codemode-deferred` | **Codemode** | An older name for `codemode`. |

`direct` stays direct in a session where codemode cannot run: when Pi's `extensions` setting lists `-builtin:codemode`, or when `autoEnableCodemode` is `false` and codemode is off.

## Server states

These are the states **Settings > MCP** shows on a server. Opening Settings connects to nothing, so a state comes from a session connected to the server, or else from the last **Check connection**.

| State | Meaning |
| --- | --- |
| **Connected** | Connected, with the number of tools it offers. |
| **Connecting…** | Connecting now. |
| **Checking…** | **Check connection** is running. |
| **Not connected** | Not connected now. |
| **Not checked yet** | Nothing is known yet. |
| **Needs sign-in** | The server uses OAuth. Choose **Sign in**. |
| **Needs secret** | It reads a secret you have not saved, shown by name. |
| **Failed** | It could not start or connect. Its page shows the error and its last printed lines. |
| **Off** | Turned off. |
| **Off in OpenWaggle** | Pi's file turns it on, but OpenWaggle keeps it off after an upgrade. You can turn it on. |

A server that another file changes also says where, such as **Overridden in** `~/.openwaggle/mcp.json`.

## Timings and limits

| Limit | Value |
| --- | --- |
| Request timeout | 60 seconds, unless the entry sets `timeout` |
| Wait before a message, for a server with known app tools | At most 1.5 seconds |
| MCP App start | 15 seconds, then the tool result stays text |
| Idle stop | 5 minutes after the session's last run ends, if no new run starts. MCP App requests restart the timer. |
| Idle stop, finished worker | 1 minute after its last run ends, for a worker under review, accepted, or cancelled |
| Sessions with servers running at once | 3. The least recently used session's servers stop first. |
| MCP versions | `2024-11-05` to `2025-11-25` |

## Registry installs

What **Install** in **Settings > MCP** and `openwaggle mcp registry add` do with each kind of server:

- OpenWaggle saves a hosted server with its URL. The command line uses the URL when there is one. `--package` picks a package instead.
- OpenWaggle pins packages to the exact version the Registry lists, and Docker images to the image Docker downloaded.
- OpenWaggle downloads MCP bundles (`.mcpb`), checks them against the SHA-256 checksum the Registry publishes, and unpacks them under `~/.openwaggle/mcp/registry-cache`. A bundle that fails the check installs nothing.
- The entry reads a secret the server needs from a secret named after the server, such as `WEATHER_AUTHORIZATION`, so two servers never share a token. OpenWaggle lists the secrets to add and those that already exist. The server does not start until they exist.
- OpenWaggle leaves out a secret the Registry marks optional, so the server starts without it, and OpenWaggle lists it after installing. To use an optional environment variable or header, add it to the entry with a secret. For a Docker image, also add `-e NAME` to its `args` before the image, or the container never receives it.
- OpenWaggle lists an optional secret command-line argument separately. A command line cannot refer to a secret, so add it to `args` with its literal value. A required secret command-line argument that the Registry gives no value for stops the install, for the same reason.

## Imports

**Import** in Settings and `openwaggle mcp import` read these apps. The `--from` name is in the second column.

| App | `--from` |
| --- | --- |
| Codex | `codex` |
| Claude's command-line app | `claude-code` |
| Claude's desktop app | `claude-desktop` |
| Cursor | `cursor` |
| VS Code | `vscode` |
| OpenCode | `opencode` |
| Zed | `zed` |
| Windsurf | `windsurf` |

### Variables

- `${env:NAME}` (Cursor, VS Code, Windsurf), `{env:NAME}` (OpenCode) and `${NAME}` (Claude's command-line app) in `env`, `headers` or an OAuth client secret become `${NAME}`.
- The same variables in arguments, the command, the working folder or the URL stay as written, with a warning that Pi does not fill them in there.
- VS Code's own variables, such as `${workspaceFolder}` or `${userHome}`, stay as written everywhere, with a warning to put the real value there.
- Any other `$`, or a leading `!`, stays plain text, so an imported value never runs a command.

### Credentials

The import does not copy a password, token, or API key it recognizes. It judges a name by its last word. `--api-key` and `DD_APP_KEY` count as credentials. `--max-tokens`, `--token-limit` and `--credentials-file` do not, so the import copies their values. Warnings name the field or flag, never the value.

- A credential in `env` or `headers`, under a name such as `API_KEY`, `GITHUB_TOKEN`, `DB_PASSWORD` or `Authorization`, becomes a reference to a secret named after the server and the field, such as `GITHUB_AUTHORIZATION`. A header's secret holds its whole value, such as `Bearer <token>`.
- Docker's `-e NAME=value`, and also `--env NAME=value`, `--env=NAME=value` or `-eNAME=value`, becomes `-e NAME`, with `NAME` read from a secret.
- mcp-remote's `--header "Authorization: Bearer …"`, run through `npx` or installed as the command, becomes `Authorization:Bearer ${AUTHORIZATION}`, filled in from a secret that holds just the token.
- mcp-remote's `--header` without the Bearer scheme becomes, for example, `X-Api-Key:${X_API_KEY}`, with a secret that holds the whole value.
- mcp-remote's `--header` that already reads a variable, such as `${AUTH_TOKEN}`, stays, and that variable's value in `env` becomes a secret reference.
- The import leaves out any other credential argument, such as `--api-key value`, `--token=value` or `-H "Authorization: …"`, together with its flag, and warns you. It keeps only a variable the other app fills in. Codex, Claude's desktop app and Zed fill in none there.
- The import removes a URL's user name and password, or a query parameter such as `?api_key=…`, and warns you. Add it as a header that reads a secret.

If the import renames a server, for example to `github-2`, its secrets follow the new name: `GITHUB_2_AUTHORIZATION`.

## Upgrading from an older version

The first time a new version starts, OpenWaggle converts its older MCP files to the current format.

- It backs up `~/.openwaggle/mcp.json` next to the file, with a name ending in `.pre-adr-0048.bak`.
- It backs up a project's `.openwaggle/mcp.json` in `~/.openwaggle/mcp/backups/`, in a folder named after the project, so the backup never ends up in your repository.
- A project file it creates to keep a server off goes into the repository's `.git/info/exclude`, unless Git already ignores or tracks it. OpenWaggle never changes `.gitignore` or other committed files.
- If MCP was off in OpenWaggle, it turns every server off.
- If MCP was on, servers that connected before stay on, and it turns the others off.
- A server in Pi's file that never ran in OpenWaggle shows as **Off in OpenWaggle**.
- The conversion covers every project OpenWaggle knew when it upgraded. Projects added later, and people who never set up MCP in OpenWaggle, start with servers on as their files say.
- A session you had switched MCP off for stays off. Turn it back on with **Use MCP servers** in the composer's **+** menu.
- For a project that is your home folder, or whose `.openwaggle` links to `~/.openwaggle`, OpenWaggle does not carry over per-project switches, because that file is shared with every project.
- OpenWaggle removes the copies it made of your Pi servers when they still match Pi's entry. A setting you changed in OpenWaggle, such as direct tools, stays as an entry that changes Pi's server. It keeps a copy you edited, or one that reads a secret.

While a file's conversion is unfinished, MCP stays off for that project, or for every project when the file is `~/.openwaggle/mcp.json`, and OpenWaggle refuses changes to those servers. For a project added after the upgrade, only its own `.openwaggle/mcp.json` waits until it can be read, and its other servers keep working. While another window or the command line converts a project that had MCP settings before the upgrade, OpenWaggle also refuses changes to servers of all projects, from every project, with "try again shortly". A project whose file needs fixing does not hold those changes back, and it keeps its old on and off choices once it is converted.

## Command line

`openwaggle mcp` mirrors `pi mcp`, and changes the same files as **Settings > MCP**. Without `-l`, commands read the two global files. With `-l` (`--local`) or `--project <path>`, they also read the project's three files.

| Command | Syntax | What it does |
| --- | --- | --- |
| `add` | `mcp add <server> [options] -- <command> [args...]` | Add a local server. |
| `add --url` | `mcp add <server> [options] --url <url>` | Add a remote server. |
| `remove` | `mcp remove <server>` | Remove a server from the file that defines it. |
| `list` | `mcp list [--json]` | List servers and check each enabled one. |
| `enable`, `disable` | `mcp enable <server>`, `mcp disable <server>` | Turn a server on or off. `--in-project` changes a global server in the current project only. |
| `login`, `logout` | `mcp login <server>`, `mcp logout <server>` | Sign in to or out of an OAuth server. |
| `import` | `mcp import [--from <apps>] [--apply]` | List servers found in other apps. `--apply` imports them. |
| `registry search` | `mcp registry search [<query>]` | Search the MCP Registry. |
| `registry get` | `mcp registry get <name> [--version <version>]` | Show one Registry server. |
| `registry add` | `mcp registry add <name>` | Install a Registry server. |
| `doctor` | `mcp doctor [--json]` | List the MCP files, their errors, and each server's state, connecting to every enabled server. |
| `serve` | `mcp serve` | Serve OpenWaggle to another MCP client. See [OpenWaggle as an MCP server](#openwaggle-as-an-mcp-server). |

New servers go to `~/.openwaggle/mcp.json`, or with `-l` to `.openwaggle/mcp.json`. Changes to an existing server go to the file that defines it. `--in-project` needs the project to be open in OpenWaggle already.

### Options for add

| Option | What it does |
| --- | --- |
| `--url <url>` | A streamable HTTP server instead of a command. |
| `--env KEY=VALUE` | An environment variable for a local server. Repeatable. |
| `--env-secret KEY=NAME` | An environment variable read from a secret. OpenWaggle's files only. |
| `--cwd <dir>` | A local server's working folder. |
| `--header KEY=VALUE` | An HTTP header. Repeatable. |
| `--header-secret KEY=NAME` | An HTTP header read from a secret. OpenWaggle's files only. |
| `--bearer-token-env-var <NAME>` | Sends `Authorization: Bearer ${NAME}`. |
| `--oauth-client-id`, `--oauth-client-secret`, `--oauth-callback-port`, `--oauth-client-name` | OAuth options. |
| `--exposure <mode>` | `codemode` (default), `deferred`, or `hidden`. |
| `--description <text>` | What the server offers. |
| `--file <file>` | `pi-global`, `openwaggle-global`, `project-mcp-json`, `project-pi`, or `project-openwaggle`. |

`mcp add` refuses `--exposure direct` with a usage error (exit code 2) and adds nothing, because OpenWaggle runs `direct` as `codemode`. A script that passed `--exposure direct` before 1.0 must pass `--exposure codemode`. `mcp list` shows the exposure OpenWaggle runs, so a server whose file says `direct` shows `codemode`. With `--json`, `configuredExposure` gives what the file says.

### Options for import and registry

| Option | Command | What it does |
| --- | --- | --- |
| `--from <apps>` | `import` | Apps to read, comma-separated. See [Imports](#imports). |
| `--apply` | `import` | Import new servers, or the ones named with `--server`. |
| `--server <name>` | `import` | Import only this server. Repeatable. |
| `--conflict skip\|replace\|rename` | `import` | What to do when a name is in use. |
| `--package npm\|pypi\|nuget\|oci\|mcpb` | `registry add` | Run a package instead of the hosted URL. |
| `--name <server>` | `registry add` | The server's name in the file. Default: the last part of the Registry name. |
| `--version <version>` | `registry get`, `registry add` | A specific version. |
| `--scope global\|project` | `registry add` | Save for all projects or this project. |
| `--exposure <mode>` | `registry add` | As for `add`. |
| `--registry <url>` | `registry` | Another MCP Registry, over HTTPS. |

`openwaggle mcp` commands report failures with the same [error kinds and exit codes](/docs/developer-workflow/hive-cli#error-kinds-and-exit-codes) as every `openwaggle` command. With `--json`, they answer in the same envelope, such as `{"schemaVersion":1,"type":"response","command":"mcp list","result":...}`.

## OpenWaggle as an MCP server

`openwaggle mcp serve` serves one tool, `openwaggle_hive`, to another MCP client. It does not start with the desktop app.

### Serve options

| Option | What it does |
| --- | --- |
| `--stdio` | Serve over standard input and output. |
| `--http <port>` | Serve over HTTP on this computer. Needs `--token-stdin`. |
| `--token-stdin` | Read the HTTP bearer token, at least 32 bytes, from standard input. |
| `--profile <name>` | Act as this [access profile](/docs/developer-workflow/hive-cli#restricted-external-agent-profiles), with its stored credential. |
| `--owner` | Act as the desktop user, narrowed to the options below. OpenWaggle agents cannot use it. |
| `--grant <capability>` | An operation group the server may use. Repeatable, or comma-separated. Required. |
| `--workspace <path>` | A folder whose projects the server may reach. Repeatable. |
| `--session <id>` | A session the server may reach, by ID or [session link](/docs/using-openwaggle/chat-and-tools#session-links). Repeatable. |
| `--profile-credential-file <path>` | Read the profile credential from this file instead of the credential store. Same as `OPENWAGGLE_PROFILE_CREDENTIAL_FILE`. |
| `--authorization-ceiling ask-for-approval\|yolo` | With `--owner` only. Default `ask-for-approval`. |
| `--export-root <path>` | Where `export-create` may write. Repeatable. |
| `--attachment-root <path>` | A folder the server may read attachments from. Repeatable. |
| `--origin-session <id>` | The only session `report` may name as its source. Takes an ID or a session link. |

Exactly one of `--profile` and `--owner` is required, and at least one `--workspace` or `--session`. `openwaggle mcp serve --help` lists the supported grants.

### Scope and authority

- An empty scope never means every session. `--workspace /` grants every project the caller can reach, so use it only when you mean that.
- A profile server holds only what both the profile and its options allow: the capabilities in both the profile and `--grant`, and the projects and sessions in both the profile's scope and `--workspace` or `--session`.
- `export-create` needs `--export-root`, and only roots inside the profile's export roots count. `--attachment-root` keeps only roots inside the profile's attachment roots. Without it, the profile's attachment roots apply.
- A profile server keeps the profile's authorization ceiling, so only `--owner` takes `--authorization-ceiling`.
- The server checks the profile when it starts, and the Session Host checks it again on every call. A revoked, deleted, or unknown profile, or a wrong credential, reaches no session. If you revoke a profile while the server runs, the Session Host refuses its next call. When queued work the server left, such as a follow-up, runs, the Session Host checks it against the profile itself.
- `mcp serve` takes the profile only from `--profile`, never from `OPENWAGGLE_PROFILE`. It refuses a credential file with `--owner`.
- A caller never inherits desktop approvals or access to every session. `--authorization-ceiling yolo` lets an `--owner` server steer or promote work into an active run and grant requested YOLO overrides, and only together with the matching grants.
- HTTP checks the `Host` and `Origin` headers, and prints its local URL without the token.
- Before 1.0, `--profile` only labeled the server, and every server held the desktop user's authority. Add `--owner` to keep that behavior, or create an access profile and pass its name.

### The openwaggle_hive tool

Each operation is the [`openwaggle hive`](/docs/developer-workflow/hive-cli) subcommand of the same name, and the agent's `hive` tool action with `_` in place of `-`. The tool lists only the operations the server's `--grant` values allow. Before 1.0 it was named `openwaggle_sessions`. The server no longer offers that name.

| Group | Operations |
| --- | --- |
| Discovery and reading | `list`, `search`, `read`, `turns`, `items`, `status` |
| Creating and organizing | `create`, `launch`, `spawn`, `fork`, `handoff`, `rename`, `archive`, `unarchive` |
| Runs and queue | `message`, `start`, `follow-up`, `steer`, `promote`, `replace`, `interrupt`, `interrupt-descendants`, `wait`, `queue-list`, `queue-withdraw`, `queue-reorder`, `queue-pause`, `queue-resume` |
| Requests and authorization | `requests-list`, `request-respond`, `approval-respond`, `authorization-set` |
| Reports and delegations | `report`, `delegation-submit`, `delegation-state`, `delegation-claim`, `delegation-conflict-acknowledge`, `delegation-dependency`, `delegation-propose-amendment`, `delegation-amend`, `delegation-request-revision`, `delegation-accept`, `delegation-reopen`, `delegation-cancel`, `delegation-verify`, `delegations-list`, `delegations-read`, `delegations-conflicts` |
| Exports | `export`, `export-create`, `export-cancel`, `exports-list`, `exports-read`, `exports-wait` |
| Agent definitions | `agent-definitions-list`, `agent-definitions-search` |

MCP does not offer scheduled tasks, because a server's grants last only as long as its process, and a scheduled task needs a creator that lasts. Use [`openwaggle schedules`](/docs/using-openwaggle/scheduled-tasks) or the agent's `hive` tool. MCP also does not offer the app's pin order, a separate worktree planning step, or a `clone` operation.

### Operation rules

- `agent-definitions-list` and `agent-definitions-search` return names and descriptions, never instructions, for a folder inside the caller's `--workspace` grants (the first one by default). `search` takes the query in `message`. They need no further grant. A session's managed worktree, or a folder in it, reads that session's project. Any other folder, including a subfolder of a project, reads only itself. OpenWaggle leaves out definitions turned off for the project.
- Results of `list`, `search`, `read`, `delegations-list` and `delegations-read` that have a delegation state also carry `nextActor`, which is `user`, `parent`, `worker` or `none`. OpenWaggle works it out the same way the Hive panel does. See [delegation states](/docs/reference/hive#delegation-states).
- In `create`, `launch`, `fork`, `spawn` and `handoff`, `workspace` picks `current`, `local`, `existing`, `new-worktree`, `share-parent` or `share-source` where the operation allows it. Worktree operations need the matching creation and organizing grants. With `new-worktree`, `startFromOrigin: true` starts the worktree from the configured origin remote. Other modes refuse `baseRef` and `startFromOrigin`.
- `spawn` takes `resourceReferences`, the files or context for the worker. `exportResources` belongs to `export-create` and never becomes worker context. Other operations refuse either field.
- `launch` and `spawn` accept `yolo: true` for one run, and `thinking` for the new session's starting thinking level.
- `message` and `start` accept `thinking`, and `yolo: true` or `runAuthorizationOverride`, only when they start a run on an idle session. `thinking` becomes the session's level, and the override applies to that one run. Queued behind an active run, they fail with `thinking_level_requires_idle_session` or `run_authorization_override_requires_idle_session`.
- `follow-up` and `replace` do not accept `thinking` or an authorization override.
- A YOLO override needs a server started with `--authorization-ceiling yolo`, or a profile whose ceiling is YOLO, and the operation's grants.
- `steer` and `promote` also need the YOLO ceiling, because they add work to an active run. `steer` adds input to the active run without replacing it. Use `replace` to interrupt and start different work.
- `promote` needs `sessionId`, `followUpId` and `expectedRunId`. When that run ID is out of date, it fails instead of steering a different run.
- `interrupt` takes `sessionId` and `expectedRunId`, and no `timeoutMs`. Check the outcome, then use `status` or `wait` to confirm the session is idle.
- `search` takes `message`, and optionally `searchMode`, `fullTranscript` and `includeArchived`. It leaves archived sessions out by default. Discovery search is hybrid by default. `fullTranscript: true` is lexical by default and needs `sessions:read`. Without that grant, the error names the missing `--grant`. Single-term and quoted transcript matches name the node, the run when known, and the order. Unquoted multi-term matches can combine several items and then name no single node.
- `create` refuses an idempotency key that starts with `pi-session-discovery:`, with `reserved_idempotency_key`. OpenWaggle keeps that prefix for the sessions it creates for discovered Pi sessions.

### Input limits

The tool refuses unknown fields, including inside interaction responses, delegation specifications, evidence, and claims. A misspelled field fails instead of being ignored.

| Input | Limit |
| --- | --- |
| Session and delegation IDs | Up to 512 characters |
| Titles | 1 to 512 characters, with at least one that is not a space |
| Top-level messages and objectives | Up to 131,072 characters |
| Single list items | Up to 16,384 characters |
| Task fields, resource references, and evidence | At most 256 entries each |
| Custom JSON responses | At most 131,072 characters once serialized |
| `limit` for discovery operations | At most 200 |
| `limit` for transcript item reads | At most 500 |

Transcript, delegation history, export, and export operation responses can return fewer records when a page reaches its size budget. Continue from the returned cursor. A single record larger than the budget returns `record_too_large`.

### Paging an export

To continue a page of `export` that returns `nextCreatedOrder`, call `export` again with that value as `afterCreatedOrder`, and copy the first page's whole `manifest` into `snapshotManifest`. Do not rebuild or edit the manifest. It fixes the session, branch, queue scope, and state the export started from. Transcript items added after the first page are not in that export. If a node in the snapshot changes or goes away between pages, the next page returns `resync_required` instead of mixing versions. Start the export again from the first page. `export-create` pages by itself and needs none of this.

### Results and errors

A successful call returns the result twice, as JSON text in `content` and as the same object in `structuredContent`. The object holds `contract` (`session-query-v2`, `session-control-v2`, or `session-lifecycle-v2`) and `response`. Read `response.outcome` for the operation's result, cursor, or idempotency details.

A failed query or a refused change comes back as an MCP tool error. The text names the code, such as `session_not_found: …` or `Session command refused (target_scope_denied): …`, the same codes the [Hive CLI](/docs/developer-workflow/hive-cli#error-kinds-and-exit-codes) uses. A session outside the server's `--workspace` and `--session` scope answers `target_scope_denied`, a session that does not exist answers `session_not_found`, and an operation the profile does not allow answers `capability_denied`. OpenWaggle checks every grant and scope again on each call.
