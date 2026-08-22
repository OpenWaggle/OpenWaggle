# Separate Composer Invocations from Global Command Surfaces

Status: accepted

OpenWaggle previously treated `/` and `Cmd/Ctrl+K` as two entrances to nearly the same composer-adjacent palette. That made the surfaces difficult to explain, introduced a second search input while the user was already typing, and let a selection replace the entire prompt. Project navigation and file discovery also lacked the centered, keyboard-first flow users expect from coding-agent desktop applications.

## Decision

- `/` is stable composer syntax. It opens an input-less chooser derived from the active Lexical selection and offers prompt-scoped skills, saved Waggle presets, and extension slash contributions. Selecting an item consumes only the active slash token. Built-in text commands such as `/compact` remain valid when typed directly but application actions are discovered through the global palette.
- Waggle preset selection creates a one-shot decorator node in the composer. The invocation travels with one `AgentSendPayload`, renders as metadata on the user turn, and is cleared with the submitted draft. It does not enable a sticky mode.
- The standard agent receives a visible native `waggle_invoke` tool. A successful call terminates the standard turn and hands a self-contained prompt plus resolved preset to Waggle in the same Pi session. Nested Waggle invocation is rejected.
- `Cmd/Ctrl+K` opens a centered global command palette for application actions, compaction, navigation, sessions, projects, settings, extension commands, and extension panels. It does not list prompt skills or Waggle presets.
- `Cmd/Ctrl+P` opens the centered project file picker, and `Cmd/Ctrl+N` starts a new session. These and the workspace shortcuts are persisted through a conflict-free shortcut registry. The three navigation shortcuts must remain assigned but may be remapped.
- Project files are indexed and accessed by an Effect service in the main process. The renderer opens a route-backed right-side file surface for tree navigation, safe previews, line targeting, optimistic autosave, and external-editor handoff. The renderer never receives arbitrary filesystem authority.
- The Waggle execution bar is transient. It is rendered only while a collaboration is pending or running.

## Consequences

- Prompt state remains owned by Lexical and scoped composer drafts; global actions remain owned by the application shell.
- Skills keep their textual `/skill-id` serialization, while Waggle invocations use explicit message metadata so coordination details do not pollute the prompt.
- Standard-to-Waggle handoff adds no parallel transcript or copied context. The completed standard tool result is persisted before the chained Waggle run starts.
- File reads and writes enforce project-root, realpath, and symlink confinement. Writes use an expected revision so external edits produce a visible conflict instead of silent overwrite.
- Extension slash contributions remain composer-native; generic extension commands and panels are discoverable only from the global command palette.
