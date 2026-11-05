---
title: "Model Context Protocol"
description: "Connect external tools and services to the agent with MCP servers, using the same configuration as Pi."
order: 5
section: "Customize"
kind: "guide"
---

Model Context Protocol, or MCP, connects the agent to tools and services outside OpenWaggle. An MCP server might search your issue tracker, read documentation, or drive a browser. Add one when the agent needs something its file and terminal tools cannot reach. You do not need MCP for ordinary editing or running commands.

OpenWaggle runs MCP the way the Pi coding agent does. A server you set up for Pi works in OpenWaggle without changes, with the same names, settings, and sign-ins. That includes `${NAME}` values: OpenWaggle reads them from your login shell's environment, as a `pi` command started in a terminal would, even when you opened the app from the Dock or the Start menu.

Only add servers you trust. A server can run a program on your computer or send requests to an outside service, and its tools can change data there. When you add a project to OpenWaggle, you also trust the servers that project configures.

Exact field lists, command options, and limits are on the [MCP reference](/docs/configuration/mcp-reference) page.

## Add a server

1. Open **Settings > MCP** and choose **Add server**.
2. Enter a **Name**. Use letters, digits, `-`, and `_`. The name must not be used by another server in any of the [five MCP files](#where-servers-are-configured). Names that differ only in `-` and `_`, such as `my-docs` and `my_docs`, count as the same name, because their tools would get the same name.
3. Under **Connects with**, choose **A command (stdio)** for a local server and enter the **Command** and its arguments, for example `npx` with `-y @modelcontextprotocol/server-filesystem .`. For a remote server, choose **A URL (HTTP)** and enter its **URL**.
4. Under **Use in**, choose **All projects** or **This project**, then choose the file under **Save to** and click **Add server**.

New servers go to OpenWaggle's own file by default: `~/.openwaggle/mcp.json` for all projects, or `.openwaggle/mcp.json` in the project. If you also use the `pi` command, you can save to one of Pi's files instead. A server for all projects always goes to a global file, and a project's server to a project file. Sign-in through a model provider (`auth`) only works in a global file.

The server connects the next time you send a message. To skip the form for two common servers, **Recommended servers** installs Playwright MCP or Chrome DevTools MCP in one click.

## Install a server from the MCP Registry

The [MCP Registry](https://registry.modelcontextprotocol.io) lists published servers. Under **MCP Registry** in **Settings > MCP**, search by name, pick **All projects** or **This project**, and choose **Install**. When a server can run more than one way, for example as a hosted server at a URL or from an npm package, pick one first.

Installing adds an ordinary entry to OpenWaggle's file, so the server then works like any other. OpenWaggle pins the exact version the Registry lists. If the server needs an API key or a token, the new entry reads it from a [secret](#keep-a-token-in-a-secret), and OpenWaggle tells you which secrets to add. The server does not start until they exist. [Registry installs](/docs/configuration/mcp-reference#registry-installs) lists how packages, bundles, and optional secrets are handled.

## Import servers from another app

Choose **Import** in **Settings > MCP**. OpenWaggle reads the MCP settings of Codex, Claude's desktop and command-line apps, Cursor, VS Code, OpenCode, Zed, and Windsurf, shows the servers it found, and adds the ones you pick to OpenWaggle's file. Choose where they go under **Import into**, and what happens to a name already in use under **If the name is in use**. You do not need to import servers you set up for Pi. OpenWaggle reads Pi's files directly.

The import never copies a password, token, or API key it recognizes. It replaces each one with a reference to a secret, named after the server and the field, such as `GITHUB_AUTHORIZATION`, or leaves it out with a warning. OpenWaggle then lists the secrets to add. Warnings name the field or flag, never the value. Variables the other app fills in, such as `${env:NAME}` in Cursor, become `${NAME}` where Pi fills variables in.

The import recognizes a credential by its name, and it cannot catch every way one can be written, for example a token under a flag called `--auth`. After importing, check the new entries in `~/.openwaggle/mcp.json` or `.openwaggle/mcp.json`, and move any credential still written out there into a secret. The exact rules are in [Imports](/docs/configuration/mcp-reference#imports).

## Where servers are configured

OpenWaggle reads five files, in this order:

| File | Used for |
| --- | --- |
| `~/.pi/agent/mcp.json` | Pi's servers for all projects |
| `~/.openwaggle/mcp.json` | OpenWaggle's servers for all projects |
| `<project>/.mcp.json` | Servers the project shares with other tools |
| `<project>/.pi/mcp.json` | Pi's servers for the project |
| `<project>/.openwaggle/mcp.json` | OpenWaggle's servers for the project |

When two files define a server with the same name, the project file wins over the global one, and a later file wins over an earlier one. [MCP config precedence](/docs/configuration/per-project-config#mcp-config-precedence) draws this order as a diagram.

A few cases change where these files are:

- Pi's global file moves with Pi's agent folder. If you set `PI_CODING_AGENT_DIR`, OpenWaggle reads `mcp.json` there.
- If a project is your home folder, or its `.openwaggle` folder links to `~/.openwaggle`, its `.openwaggle/mcp.json` is the global `~/.openwaggle/mcp.json`. OpenWaggle reads it once, as the global file, and does not offer a switch for that project only, since it would change every project.
- If a file is a symbolic link, for example into a dotfiles repository, OpenWaggle saves changes to the file the link points to and leaves the link in place.

Every file uses the same format. This one defines a local server and a remote one:

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

`command` is one program and `args` its arguments. OpenWaggle does not run it through a shell. `${NAME}` in `headers` or `env` reads a variable from your login shell, but `url`, `command`, and `args` are used exactly as written. If a value cannot be filled in, for example because a variable or secret is missing, that server reports the error and the others still connect. [Server entries](/docs/configuration/mcp-reference#server-entries) lists every field, including `timeout` (60 seconds by default), `enabled`, and the SSE and WebSocket transports.

An entry with only `enabled`, `exposure`, or `toolExposure` changes a server defined in an earlier file and keeps the rest of it. For example, this in `.openwaggle/mcp.json` turns off a global server in one project:

```json
{
  "mcpServers": {
    "internal-tools": { "enabled": false }
  }
}
```

## Keep a token in a secret

In OpenWaggle's own files, you can keep a value in OpenWaggle's encrypted secret store instead of writing it in the file. Add the secret under **Settings > MCP > Secrets**, then refer to it by name:

```json
{
  "mcpServers": {
    "github": {
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": { "Authorization": { "secret": "github-authorization" } }
    }
  }
}
```

A secret replaces the whole value, so `github-authorization` holds `Bearer <token>`, not just the token.

Secret references only work in `~/.openwaggle/mcp.json` and `.openwaggle/mcp.json`. Pi and other tools read the other files and would not understand them.

Until you add a secret a server needs, OpenWaggle leaves that server out of your sessions. **Settings > MCP** shows **Needs secret** and the secret's name on the server, and **Add in Secrets** on the server's page opens **Secrets** with the name filled in. A secret that another OpenWaggle version saved, and this one cannot read, is listed but does not work. The server reports it when a session starts. Saving the secret again fixes it.

On Linux, unlock your keyring before you first save a secret in a new OpenWaggle version. If the keyring is locked, secrets an older version saved cannot be read, and they are left behind when the new version saves its first secret.

## Turn a server on or off

Select a server in **Settings > MCP** to see where it is defined, whether it is connected, its tools, and any error, including the last lines a local server printed. From there you can turn it on or off, choose how its tools reach the agent, sign in or out, or remove it.

![The settings page of the connected release-notes server, with its On switch, the Codemode and Hidden exposure choices, and its three tools](/screenshots/mcp-server-detail.png)

The main switch turns the server on or off everywhere. **Turn off in this project** or **Turn on in this project** changes it for the current project only.

OpenWaggle saves a change to the file that defines the server, with one exception. A change for one project is always saved in that project, never in a global file. If the project already changes that server in one of its files, for example `.pi/mcp.json`, OpenWaggle updates that entry. Otherwise it writes to `.openwaggle/mcp.json`. When you switch the server back to what the other files say, OpenWaggle removes the switch from that entry, and the entry too if nothing else is left in it. Later changes for every project then apply to this project again.

## Turn off MCP for one session

To keep one session away from every MCP server, open the composer's **+** menu and clear **Use MCP servers**. The session's MCP servers stop at once, even in the middle of a reply, and its later replies start none. Turning it back on applies from your next message. Sessions use MCP servers until you do this, and the switch changes no file.

## Remove a server

Choose **Remove** on the server's page. Removing a server also removes the entries in OpenWaggle's files that only changed it. For a server of all projects, that happens in every project OpenWaggle knows.

An entry like that left in a project OpenWaggle no longer lists is shown as ignored and changes nothing. Choose **Remove override** next to it to delete it from OpenWaggle's file. Entries like that in Pi's files or in `.mcp.json` stay as they are and are listed as errors, so you can remove them yourself.

## Choose how tools reach the agent

Each server's **Exposure** decides how the agent can use its tools. Tool names look like `mcp__<server>__<tool>`. In **Settings > MCP** you choose one of two:

| Exposure | What the agent sees |
| --- | --- |
| **Codemode** (default) | The agent finds the tools and calls them from short scripts, so many tools cost little context. |
| **Hidden** | The tools cannot be used. |

You can give a single tool its own exposure, for example to hide a delete tool. Tools that open an app (see [MCP Apps](#apps-sampling-and-input-requests)) are offered to the agent directly, so it calls them itself and the app shows in the conversation. A hidden app tool stays hidden.

Pi's files can also say `direct` or `deferred`. OpenWaggle runs `direct` as codemode and shows it as **Codemode**, because offering every tool's description on every message cost thousands of tokens per message, and agents rarely called those tools. You do not need to change anything, and OpenWaggle leaves the file alone, so the `pi` command still offers those tools directly. `deferred` works as before: the agent searches for those tools, then calls them directly. [Exposure values](/docs/configuration/mcp-reference#exposure-values) covers the sessions where `direct` stays direct.

In **Ask for approval** mode, every MCP tool call asks for your approval, including calls made from a script. Choosing **Allow** is remembered for that server and tool.

## Sign in to a server

Remote servers that use OAuth, such as Sentry or Figma, need no credentials in the file. When one needs you to sign in, its row in **Settings > MCP** says **Needs sign-in**. Choose **Sign in** and finish in your browser.

OpenWaggle keeps sign-ins in its encrypted store. If you already signed in to a server with the `pi` command, you are signed in in OpenWaggle too. Signing out in OpenWaggle does not change Pi's sign-in file.

A server that a Pi extension adds is not in **Settings > MCP**, so you cannot sign in to it there. It signs in when a run first uses it, by opening the sign-in page in your browser.

OAuth options such as a registered client ID, a fixed callback port, or scopes go under `oauth`, as described in Pi's MCP documentation.

## When servers start and stop

A server connects in the background when a session sends a message. Only a server with app tools that OpenWaggle already knows about can delay a message, by at most 1.5 seconds, so its app tools are there from the first message. Right after OpenWaggle starts, the first message that uses MCP servers can wait a few seconds while OpenWaggle reads your login shell's environment, so servers find the commands on your `PATH`. After an upgrade, it may also move your old sign-ins then, when a server with a URL is on. A session with no server turned on waits for MCP only while OpenWaggle converts a project's older MCP files: the first time it sees the project, or again after a conversion failed.

The connection stays open for the session's later messages, so a server keeps its state through a conversation. Each session has its own connections. A worker or a fork starts its own.

OpenWaggle remembers each server's tools from the last time it connected. A session gets those tools as soon as it starts, and a local server's process only starts when the agent first uses one of them. A session that never calls a server never starts it. If the server then offers different tools, the session's list is updated. A server started through `npx`, `pnpm dlx`, or `bunx` is started directly after its first launch, without the package runner staying alive beside it.

A session's servers stop:

- 5 minutes after the session's last message.
- 1 minute after the last message, for a worker whose result is under review, accepted, or cancelled.
- When the session is archived or deleted.
- When no OpenWaggle window or command is connected to the background Session Host, and when the Session Host stops.

When more than three sessions have servers running, the servers of the session used least recently stop first. A session with a message in progress keeps its servers. Stopping a local server also stops any program it was started through, such as `npx` or `uvx`.

## Check a server's connection

Opening **Settings > MCP** starts no server. Each server shows what is already known: the state of a session connected to it, or else the result of the last check, or else **Not checked yet**. Turning a server off or on, or saving one of its secrets again, clears the result of an earlier check.

![The Servers list in Settings > MCP with three servers, marked Needs secret, Failed, and Connected with 3 tools](/screenshots/mcp-servers.png)

Choose **Check connection** on a server to connect to it, list its tools, and disconnect. A check always goes through the package runner, such as `npx`, so it also picks up a new version of an `@latest` server. `openwaggle mcp list` checks every enabled server the same way.

## Apps, sampling, and input requests

A server can do more than answer tool calls:

- **MCP Apps** are small interactive pages a server attaches to a tool result. They appear under the tool call in the conversation and run apart from OpenWaggle. An app can load code and data only from the sites its server declares. It sizes itself to what it shows. If it has not started after 15 seconds, OpenWaggle says so and the tool call keeps its result as text.
- **Sampling** lets a server ask your model to write something. OpenWaggle asks for your approval first and never shares the conversation.
- **Input requests**, also called elicitation, let a server ask you for information, in a form or on a web page the server names.

## When something fails

Open **Settings > MCP** and select the server. Its error and the last lines it printed usually say what is wrong: a missing program, a wrong URL, or an expired sign-in. Fix the configuration, then choose **Check connection**.

![A failed local server's page, showing the error MCP connection closed and its last printed line, ISSUE_TRACKER_URL is not set](/screenshots/mcp-server-error.png)

Files that cannot be read, and entries that are not valid, are listed at the top of **Settings > MCP**. The other servers keep working.

To check everything from a terminal, run:

```bash
openwaggle mcp doctor --local
```

It prints which of the five files exist, the errors in them, and each server's state with the last lines it printed. It connects to every enabled server to check it. `--local` includes the current project's files. Add `--json` for a report a script can read.

OpenWaggle supports MCP versions `2024-11-05` to `2025-11-25`. A server that only speaks a newer or older version cannot connect yet.

### After upgrading from an older OpenWaggle

The first time a new version starts, OpenWaggle converts its older MCP files and keeps a backup of each file it changes. Servers stay on or off as they were. [Upgrading from an older version](/docs/configuration/mcp-reference#upgrading-from-an-older-version) lists where the backups go and how each server is carried over.

If the conversion cannot finish for a file, MCP servers stay off until it does, for that project, or for every project when the file is `~/.openwaggle/mcp.json`. That way a server you had turned off does not start. Until then OpenWaggle refuses changes to those servers, and the message says what to do:

- "Try again shortly" means another OpenWaggle window or the command line was converting the same files. Make the change again in a moment. OpenWaggle also retries on your next change, when Settings opens, and with your next message.
- "Fix" followed by a file means the file cannot be read, for example because its JSON is broken, or it links to a folder that is not there, such as a dotfiles folder that is not mounted. Fix or restore the file, then open **Settings > MCP** again.

A new install has nothing to convert, so nothing waits.

## Manage servers from the command line

The macOS and Linux installer puts `openwaggle` in `~/.local/bin`. The Windows installer puts `openwaggle.cmd` beside the installed app and adds that folder to your `PATH`. Open a new terminal after installing.

To add a local server for all projects, run:

```bash
openwaggle mcp add filesystem -- npx -y @modelcontextprotocol/server-filesystem .
```

To add a remote server, give its URL:

```bash
openwaggle mcp add docs --url https://example.com/mcp
```

To see every server and check that it connects, run:

```bash
openwaggle mcp list
```

New servers go to `~/.openwaggle/mcp.json`, or to `.openwaggle/mcp.json` in the current project with `--local`. `openwaggle mcp disable --in-project docs` turns a global server off in the current project only, like **Turn off in this project** in Settings. The project must already be open in OpenWaggle. The [command line reference](/docs/configuration/mcp-reference#command-line) lists every command and option, including `import`, `registry`, `login`, and `--exposure`.

## OpenWaggle as an MCP server

You can also go the other way and let another MCP client, such as a different agent tool, work with your OpenWaggle sessions. This is separate from the servers in Settings, and it does not start with the desktop app.

`openwaggle mcp serve` starts the server. It serves one tool, `openwaggle_hive`, with the same operations as the [`openwaggle hive`](/docs/developer-workflow/hive-cli) command. You decide who the client acts as and what it may reach:

- Give it an [access profile](/docs/developer-workflow/hive-cli#restricted-external-agent-profiles) with `--profile`, for another agent tool, or your own access as the desktop user with `--owner`. OpenWaggle agents cannot use `--owner`.
- List the projects or sessions it may reach with `--workspace` or `--session`.
- Grant only the operations it needs with `--grant`.

All three are required. An empty scope never means every session. To make a profile for a helper that only finds and reads sessions in one project, run this, with your project's path:

```bash
openwaggle access profiles create ci-helper --capability sessions:discover --capability sessions:read --project /path/to/project --credential-store
```

Then point the other client at this command, which serves that profile over standard input and output:

```bash
openwaggle mcp serve --stdio --profile ci-helper --grant sessions:discover --grant sessions:read --workspace /path/to/project
```

To serve over HTTP on your own computer instead, pass a bearer token of at least 32 bytes on standard input. This serves your own access to one session, on a free port; replace `SESSION_ID` with the session's ID or a [session link](/docs/using-openwaggle/chat-and-tools#session-links):

```bash
printf '%s' "$OPENWAGGLE_MCP_TOKEN" | openwaggle mcp serve --http 0 --token-stdin --owner --grant sessions:discover --session SESSION_ID
```

The server prints its local URL but never the token. An `--owner` server can ask for approval at most, unless you start it with `--authorization-ceiling yolo` after reviewing the client. Run `openwaggle mcp serve --help` for every option, and see [OpenWaggle as an MCP server](/docs/configuration/mcp-reference#openwaggle-as-an-mcp-server) in the reference for the operations, limits, and errors.
