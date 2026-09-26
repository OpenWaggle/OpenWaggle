---
title: "Agent definitions"
description: "Create a reusable role for new sessions, with instructions and optional model or tool defaults."
order: 3
section: "Multiple agents"
---

An agent definition gives a new session a reusable role, such as a code reviewer. It is an optional Markdown file with instructions and defaults. You do not need one to use OpenWaggle or create [Workers in a Hive](/docs/using-openwaggle/hives-and-sessions).

## Create a role

1. Create `.openwaggle/agents/code-reviewer.md` in your project.
2. Add the [Pi-style example below](#pi-style-format), adjusting the instructions for your project.
3. Open **Settings > Agents**, choose the project, and preview the file. Keep the definition enabled if you want agents to select it for new sessions.
4. Ask your agent to use the `code-reviewer` definition when creating a Worker. Include the task and file references the Worker needs.

Edit the Markdown file directly; Settings does not have a form editor. Changes apply to later sessions, not to a session already using the definition.

A role is separate from Hive lineage. Queen and Worker describe which session started which. Either can use any available definition, or none. A definition can restrict existing permissions but cannot grant new ones.

## Locations and precedence

OpenWaggle discovers definitions by stable frontmatter `name` in this order:

1. `<project>/.openwaggle/agents/*.md`
2. `<project>/.agents/agents/*.md`
3. `~/.openwaggle/agents/*.md`

The first matching name wins. An invalid higher-precedence file does not silently fall through to a lower-precedence definition.

## Format

OpenWaggle accepts either its versioned v1 frontmatter or the smaller Pi-style format. Both use a Markdown body for instructions. Use v1 when you need OpenWaggle-specific policy fields; use the Pi-style format for a portable name, description, optional model, and tools list.

### Pi-style format

```markdown
---
name: code-reviewer
description: Reviews code for concrete defects
tools: read, grep
---

Review the change and report actionable findings with file references.
```

`tools` can also be a YAML list, such as `[read, grep]`. In the Pi-style format, an omitted or empty `tools` value inherits the normal tool set. This differs from OpenWaggle v1, where `tools: []` explicitly allows no tools. Pi-style files do not use `schemaVersion` and do not accept OpenWaggle-specific fields. The same bounded Markdown file and portable-name rules apply.

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

Add `model: provider/model` if you want a preferred model. Use an identifier available in your project's model catalog, and choose a reasoning level that model supports.

The non-empty Markdown body is the agent instruction text. The complete frontmatter schema is published by the documentation site at `/schemas/agent-definition-v1.schema.json`.

| Field | Required | Meaning |
|---|---:|---|
| `$schema` | No | Editor schema URL; it does not select behavior. |
| `schemaVersion` | Yes for v1 | Exact OpenWaggle document contract. Version `1` is currently supported; omit it for Pi-style files. |
| `name` | Yes | Stable lowercase identity using letters, numbers, `.`, `_`, or `-`. |
| `description` | Yes | Bounded catalog summary used by humans and agent discovery. |
| `model` | No | Preferred existing `provider/model`; it cannot authorize a provider. |
| `reasoning` | No | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. |
| `tools` | No | Tool allowlist. Omission inherits; `[]` exposes none. |
| `skills` | No | Skill allowlist with the same omission/empty semantics. |
| `mcpServers` | No | MCP-server allowlist with the same omission/empty semantics. |
| `sessionCapabilities` | No | Operation-level reduction for the native `sessions` tool. |
| `authorizationMode` | No | `ask-for-approval` or `yolo`, bounded by the caller's ceiling. |
| `workspace` | No | `share-parent`, `local`, or `new-worktree` default. |
| `import` | Managed | Provenance written by an import adapter; do not hand-author it. |

Unknown fields, YAML aliases, merge keys, custom tags, duplicate keys, empty instructions, and oversized documents are rejected. Frontmatter is limited to JSON-compatible YAML and is never evaluated as code or interpolated from the environment.

## Browsing and disabling agents

Open **Settings → Agents** to see the effective definitions for a project. Use the project picker in the Agents header to browse recent projects or projects with Sessions; you can also open another folder there. Browsing Agents does not switch the active project in the composer. Select a row to preview its full Markdown file, including frontmatter. The switch disables that name for future named launches and spawns in the project shown in the picker. It does not delete the file, modify the Markdown, or change a Session that already snapshotted the definition. A Worker without a named definition remains available. If the same name exists at multiple discovery locations, the highest-precedence file is displayed and the switch applies to that name, not to one individual file.

## Inheritance and authority

Explicit launch or spawn options win over definition defaults. Omitted values inherit from the initiating Session or normal app/project defaults. Tool, skill, MCP, and Session-capability lists are allowlists. They can only select capabilities the caller already has. An empty list means none; omission inherits. A definition cannot grant a capability, credential, YOLO access, filesystem access, or network access that the caller does not already possess.

The selected definition is resolved and snapshotted when the Session is created. Editing its Markdown file affects later Sessions, not a Run already using a snapshot. A Worker cannot modify its own active snapshot to escalate itself, though normal filesystem permissions may allow it to author definitions for future Sessions.

## CLI

```sh
openwaggle agents list --project /path/to/project
openwaggle agents search security --project /path/to/project
openwaggle agents validate ./security-reviewer.md --json
openwaggle agents import ./security-reviewer.md --from openwaggle --scope project --dry-run
openwaggle agents import ~/.codex/agents/reviewer.toml --from codex --scope project
openwaggle agents explain security-reviewer --project /path/to/project --json
```

`validate` and `explain` resolve every referenced model, tool, skill, and MCP server against the
selected project's live runtime catalogs. MCP servers may be referenced by configured name or stable
instance ID. Validation returns a non-zero exit code and structured, actionable diagnostics when a
reference is unknown, duplicated, or cannot be checked because a project catalog failed to load.
`create`, `update`, import, and refresh use the same validation before writing, so an invalid role is
not installed through the CLI.

Pass `--json` when another tool consumes the command. Successful commands emit a
`{"schemaVersion":1,"result":...}` envelope on stdout and exit with code 0. `validate` and `explain`
also use the result envelope when the command runs but finds invalid semantics. In that case,
`validate` reports `{"schemaVersion":1,"result":{"valid":false,"diagnostics":[...]}}`, `explain`
includes the failed `semanticValidation` in its result, and either command exits with code 1.

Usage, transport, and command failures emit
`{"schemaVersion":1,"error":{"message":"..."}}` on stderr. Usage errors exit with code 2; other
failures exit with code 1. Consumers should read the envelope from the documented stream before
interpreting the exit code.

Import uses an explicit source adapter for OpenWaggle, Codex, Claude Code, Cursor, Gemini CLI,
GitHub Copilot, or OpenCode. A dry run returns the schema-versioned conversion plan, diagnostics,
unmapped source fields, and destination without writing. Conversion must resolve ambiguous names and
capabilities explicitly; it never guesses new authority. Import validates before writing and refuses
to replace an existing same-name destination unless `--replace` is explicit. The stored provenance
and baseline digest allow `agents refresh` to detect source and destination changes instead of
silently overwriting local edits. Scopes are `project`, `portable-project`, and `user`.
When the same name exists in more than one scope, use `agents refresh <name> --scope <scope>`
to refresh a specific definition. Without `--scope`, the CLI refreshes the normal highest-precedence definition.
To change a definition yourself, edit its Markdown file. A new Session uses the revised file; a
Session already using a snapshot keeps its existing definition.

Agents can discover names and descriptions on demand through the native `sessions` tool using `agent_definitions_list` or `agent_definitions_search`. Instruction bodies are not injected into every Run.
