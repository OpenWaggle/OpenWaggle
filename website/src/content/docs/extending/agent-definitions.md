---
title: "Agent definitions"
description: "Create a reusable role for new sessions, with instructions and optional model or tool defaults."
order: 3
section: "Multiple agents"
kind: "guide"
---

An agent definition is a reusable role, such as a code reviewer, saved as a Markdown file. The file holds the role's instructions and, if you want, a preferred model, thinking level, tool list and other defaults. Use one when you keep asking agents for the same kind of worker and want it set up the same way each time. You do not need any to use OpenWaggle or to create [workers in a Hive](/docs/using-openwaggle/hives-and-sessions).

## Create a role

1. Create `.openwaggle/agents/code-reviewer.md` in your project.
2. Copy in the [Pi-style example](#pi-style-format) below and change the instructions for your project.
3. Open **Settings > Agents**, choose the project, and select the definition to preview it. Leave its switch on so agents can use it.
4. Ask your agent to use the `code-reviewer` definition when it creates a worker. Include the task and the files the worker needs.

![Settings > Agents with two enabled definitions, code-reviewer and release-verifier, and release-verifier's file in the preview](/screenshots/settings-agents.png)

To change a role, edit its Markdown file. Settings shows the file but has no editor. A change applies to sessions created after it, not to a session that already uses the definition.

A role has nothing to do with a session's place in a Hive. The Queen and its workers can each use any available definition, or none. A definition can take permissions away, but it cannot add any.

## How agents find your definitions

A session that can create other sessions sees a list of the project's enabled, valid definitions in its instructions, in a section called `available_agents`. The list has each definition's name and description, up to 24 definitions, with each description cut at 280 characters. The instructions tell the agent to pass the definition's name when one fits a worker's job, instead of describing the role in the task. It finds definitions past the first 24 with the `hive` tool's `agent_definitions_list` and `agent_definitions_search`.

The instructions themselves are not added to every run. A session gets a definition's instructions only when it is created with that definition.

If an agent creates a worker without a definition but describes a definition's role in the task, the `hive` tool answers with a hint naming that definition, so the next worker in that role uses it. The hint never changes the worker it just created.

So write a `description` that says when to use the role, for example "Use when a change needs a security review". That sentence is what lets agents pick it.

In the Hive panel, a worker created from a definition shows the definition's name, thinking level and model under its title. [Give workers a role](/docs/using-openwaggle/hives-and-sessions#give-workers-a-role) shows how it looks.

## Where to put definition files

OpenWaggle looks for definitions by their frontmatter `name`, in this order:

1. `<project>/.openwaggle/agents/*.md`
2. `<project>/.agents/agents/*.md`
3. `~/.openwaggle/agents/*.md`

The first file with a given name wins. If that file is invalid, OpenWaggle reports it. It does not fall back to a file with the same name further down the list.

## Write a definition

OpenWaggle reads two formats. Both put the instructions in the Markdown body. Use the Pi-style format for a portable name, description, optional model and tool list. Use OpenWaggle's v1 format when you need OpenWaggle's own fields, such as session capabilities or a default workspace.

### Pi-style format

```markdown
---
name: code-reviewer
description: Reviews code for concrete defects
tools: read, grep
---

Review the change and report actionable findings with file references.
```

`tools` can also be a YAML list, such as `[read, grep]`. In the Pi-style format, leaving `tools` out or empty gives the agent the normal tool set. That differs from v1, where `tools: []` allows no tools. Pi-style files have no `schemaVersion` and do not accept OpenWaggle's own fields. The same size and name rules apply.

### OpenWaggle v1 format

```markdown
---
$schema: https://openwaggle.ai/schemas/agent-definition-v1.schema.json
schemaVersion: 1
name: security-reviewer
description: Reviews authorization and trust boundaries
reasoning: high
tools: [read, grep]
skills: [code-review]
mcpServers: []
sessionCapabilities: [sessions:discover, sessions:read, sessions:report]
authorizationMode: ask-for-approval
workspace: new-worktree
---

Review the requested change. Report concrete findings with file and line references.
```

Add `model: provider/model` for a preferred model. Use a model from your project's model catalog, and a reasoning level that model supports.

The body must not be empty. It is the agent's instructions. The full frontmatter schema is published at [`/schemas/agent-definition-v1.schema.json`](https://openwaggle.ai/schemas/agent-definition-v1.schema.json). `$schema` is optional and only helps your editor. It changes nothing.

| Field | Required | Meaning |
|---|---|---|
| `schemaVersion` | v1 only | The format version. Only `1` exists. Leave it out of Pi-style files. |
| `name` | Yes | Up to 80 lowercase letters, numbers, `.`, `_` or `-`, starting and ending with a letter or number. |
| `description` | Yes | A summary of up to 500 characters that people and agents read. |
| `model` | No | A preferred `provider/model`. It cannot unlock a provider you have not set up. |
| `reasoning` | No | `off`, `minimal`, `low`, `medium`, `high`, `xhigh` or `max`. |
| `tools` | No | The tools the agent may use. Leave it out for the normal set, or use `[]` for none. |
| `skills` | No | The skills the agent may use. Same rules as `tools`. |
| `mcpServers` | No | The MCP servers the agent may use. Same rules as `tools`. |
| `sessionCapabilities` | No | The session capability IDs the agent keeps, such as `sessions:read`. [Hive actions and states](/docs/reference/hive) lists the actions each one allows. |
| `authorizationMode` | No | `ask-for-approval` or `yolo`, within the caller's own limit. |
| `workspace` | No | The default workspace: `share-parent`, `local` or `new-worktree`. |

`import` is written by `openwaggle agents import` to record where the file came from. Do not write it yourself.

Each list holds at most 128 entries. A file can be up to 128 KiB, with up to 64 KiB of instructions. A name cannot be a reserved Windows file name such as `con` or `nul`.

OpenWaggle rejects a file with unknown fields, YAML aliases, merge keys, custom tags, duplicate keys, empty instructions, or more content than these limits allow. Frontmatter is plain JSON-style YAML. OpenWaggle never runs it as code or fills it in from environment variables.

### MCP tools in `tools`

MCP tools have the names Pi gives them, `mcp__<server>__<tool>`, where a `-` in the server name becomes `_`. In `tools` you can list one tool, such as `mcp__github__get_issue`, or use `*` for any characters, such as `mcp__dev_radius__*` for every tool of `dev-radius`. The server must be configured in the project. Listing any MCP tool also allows `codemode`, `tool_search` and the MCP resource tools, which are how the agent reaches MCP tools.

Older definitions may list `mcp` or `mcp_run`, the names of OpenWaggle's former MCP tools. They still work, and mean every MCP tool of the servers in `mcpServers`, or of every server when `mcpServers` is left out.

The list also applies to tools a `codemode` script calls. A script cannot call a tool the definition does not list.

OpenWaggle refuses a call to a tool outside the list before it asks you for approval. Pi extensions you install from files or packages load before OpenWaggle's own, so their `tool_call` handlers still see a refused call before OpenWaggle blocks it. The call is blocked either way.

## Turn a definition off

**Settings > Agents** lists the definitions in effect for a project. Use the project picker at the top of the list to browse recent projects or projects with sessions, or to open another folder. Browsing here does not change the project in the composer. Select a row to see its whole Markdown file, frontmatter included.

The switch on a row turns that name off for new sessions and workers in the project shown in the picker. It does not delete or change the file, and it does not affect a session that already uses the definition. Agents can still create workers without a definition. If the same name exists in more than one place, Settings shows the file that wins, and the switch applies to the name, not to one file.

## What a definition can and cannot change

Options given when the session is created win over the definition's defaults. Anything neither sets comes from the session that created it, or from your app and project defaults.

The `tools`, `skills`, `mcpServers` and `sessionCapabilities` lists can only choose from what the caller already has. An empty list means none. Leaving the field out keeps what the caller has. A definition cannot give an agent a capability, credential, **YOLO** access, file access or network access that the caller does not already have.

OpenWaggle reads the definition and keeps a copy of it when the session is created. Editing the file later affects new sessions, not a run already using the copy. A worker cannot edit its own copy to give itself more access, although normal file permissions may let it write definitions that later sessions use.

## Check and import definitions from the command line

The `openwaggle agents` command checks, explains and imports definition files. `openwaggle agents help` lists every subcommand, including `create`, `update`, `duplicate`, `delete` and `refresh`. In these examples, replace `PROJECT_PATH` with your project's folder, `./security-reviewer.md` with the path of your definition file, and `security-reviewer` with its name.

To list the enabled definitions of a project:

```sh
openwaggle hive agent-definitions-list --project PROJECT_PATH
```

To search them by name and description:

```sh
openwaggle hive agent-definitions-search security --project PROJECT_PATH
```

To check a file before you install it:

```sh
openwaggle agents validate ./security-reviewer.md --json
```

To see how OpenWaggle resolves an installed definition in a project:

```sh
openwaggle agents explain security-reviewer --project PROJECT_PATH --json
```

`validate` and `explain` look up every model, tool, skill and MCP server the definition names in the project's current catalogs. MCP servers are named by their configured name. A definition written before OpenWaggle used Pi's MCP configuration may still use a server's old instance ID, which keeps working while that server is configured. When a name is unknown, listed twice, or cannot be checked because a project catalog failed to load, validation lists what is wrong and exits with a non-zero code. `create`, `update`, `import` and `refresh` run the same checks before they write, so the CLI never installs an invalid role.

### Import a role from another tool

`import` converts a definition from OpenWaggle, Codex, Claude Code, Cursor, Gemini CLI, GitHub Copilot or OpenCode. Name the source with `--from`, or use `--from auto`. Choose where it goes with `--scope`: `project` writes to `.openwaggle/agents`, `portable-project` to `.agents/agents`, and `user` to `~/.openwaggle/agents`.

To preview an import without writing anything:

```sh
openwaggle agents import ./security-reviewer.md --from openwaggle --scope project --dry-run
```

To import a Codex agent into the project:

```sh
openwaggle agents import ~/.codex/agents/reviewer.toml --from codex --scope project
```

A dry run shows the converted definition, any problems, the source fields it could not map, and where it would write. The conversion never guesses. You resolve unclear names and capabilities yourself, and it never grants access the source did not have. Import checks the result before writing and will not replace a definition with the same name unless you pass `--replace`.

Import records where the file came from and what it looked like. `openwaggle agents refresh <name>` uses that record to notice changes in the source and in your copy, so it never overwrites your local edits without telling you. When the same name exists in more than one scope, pass `--scope` to choose which one to refresh. Without it, the CLI refreshes the one that wins.

### JSON output and exit codes

Pass `--json` when another program reads the output. A command that succeeds prints the [Hive CLI envelope](/docs/developer-workflow/hive-cli#json-output), `{"schemaVersion":1,"type":"response","command":"agents validate","result":...}`, on stdout and exits with code 0.

`validate` and `explain` also print that envelope when they run but find the definition invalid. `validate` then reports `{"schemaVersion":1,"type":"response","command":"agents validate","result":{"valid":false,"diagnostics":[...]}}`, `explain` includes the failed `semanticValidation` in its result, and both exit with code 1.

Usage, connection and command failures print `{"schemaVersion":1,"type":"error","error":{"kind":"...","message":"..."}}` on stderr, or `error [<kind>]: <message>` without `--json`. Usage errors exit with code 2. Other failures exit with the code of their kind, 1 for most. A program should read the envelope from the right stream before it looks at the exit code.
