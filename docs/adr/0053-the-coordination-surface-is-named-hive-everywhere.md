# The coordination surface is named Hive everywhere

Status: accepted, and implemented before `1.0.0-rc.1` (issue #347)

The agent's Session Control tool, its CLI and its MCP tool were all named "sessions", which hid that their main job is coordinating **Worker Sessions** and collided with Pi sessions and the sidebar's sessions. We rename all three to one name and one vocabulary: the Pi tool `hive`, the CLI `openwaggle hive <action>`, and the MCP tool `openwaggle_hive`. Each tool action is a CLI subcommand and an MCP operation of the same name (`follow_up` is `follow-up`), so knowing one front door means knowing the others. A Session is still a Session; `hive` only names the surface that coordinates and reaches them.

The CLI mirrors the tool exactly rather than grouping commands by object as `gh` does: the former `openwaggle delegations` group and `openwaggle agents list`/`search` became `hive delegations-list`, `hive delegation-accept`, `hive agent-definitions-search` and so on, because a second spelling of an action is the confusion the rename removes. `openwaggle agents` keeps only Agent-definition authoring (`validate`, `import`, `explain`), which edits files, and `openwaggle access` stays, since the tool has no counterpart.

Considered and rejected: `agents` (collides with Agent definitions), `workers` (wrong for launch and catalog reads), splitting into Codex-style per-action tools (a redesign of the model-facing interface, not a rename), and keeping `openwaggle sessions` as the CLI's object-named group (two names for one surface).

Consequence: this is a full migration made during the beta, before the v1 **Compatibility promise** applies. No old name is accepted anywhere: not as a CLI command, an MCP tool, or an Agent-definition `tools:` entry. A definition that still lists `sessions` is reported as naming an unknown tool, and a Pi transcript that recorded a `sessions` call keeps that call as history and renders it as an unrecognized tool rather than being rewritten.
