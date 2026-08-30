---
title: "Agent Definitions"
description: "Create optional, reusable Agent roles without changing Hive lineage or granting authority."
order: 2
section: "Extending"
---

Agent definitions are optional Markdown files that specialize a newly created Session. They can supply instructions and defaults for a model, reasoning level, tools, skills, MCP servers, Session capabilities, authorization mode, and Workspace placement. OpenWaggle does not ship required `implementer`, `explorer`, or `reviewer` roles: the absence of a selected definition is the normal default.

An Agent definition is not a Queen or Worker type. Queen and Worker describe durable Hive lineage; an Agent definition describes an optional role. A Queen or Worker can use any definition, or none.

## Locations and precedence

OpenWaggle discovers definitions by stable frontmatter `name` in this order:

1. `<project>/.openwaggle/agents/*.md`
2. `<project>/.agents/agents/*.md`
3. `~/.openwaggle/agents/*.md`

The first matching name wins. An invalid higher-precedence file does not silently fall through to a lower-precedence definition.

## Format

```markdown
---
$schema: https://openwaggle.ai/schemas/agent-definition-v1.schema.json
schemaVersion: 1
name: security-reviewer
description: Reviews authorization and trust boundaries
model: openai/gpt-5.6
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

The non-empty Markdown body is the Agent instruction text. The complete frontmatter schema is published by the documentation site at `/schemas/agent-definition-v1.schema.json`.

| Field | Required | Meaning |
|---|---:|---|
| `$schema` | No | Editor schema URL; it does not select behavior. |
| `schemaVersion` | Yes | Exact document contract. Version `1` is currently supported. |
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

## Inheritance and authority

Explicit launch or spawn options win over definition defaults. Omitted values inherit from the initiating Session or normal app/project defaults. Tool, skill, MCP, and Session-capability lists are allowlists: they intersect with the caller's existing surface. An empty list means none; omission inherits. A definition cannot grant a capability, credential, YOLO access, filesystem access, or network access that the caller does not already possess.

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
not installed through the CLI or settings UI.

Import uses an explicit source adapter for OpenWaggle, Codex, Claude Code, Cursor, Gemini CLI,
GitHub Copilot, or OpenCode. A dry run returns the schema-versioned conversion plan, diagnostics,
unmapped source fields, and destination without writing. Conversion must resolve ambiguous names and
capabilities explicitly; it never guesses new authority. Import validates before writing and refuses
to replace an existing same-name destination unless `--replace` is explicit. The stored provenance
and baseline digest allow `agents refresh` to detect source and destination changes instead of
silently overwriting local edits. Scopes are `project`, `portable-project`, and `user`.

Agents can discover names and descriptions on demand through the native `sessions` tool using `agent_definitions_list` or `agent_definitions_search`. Instruction bodies are not injected into every Run.
