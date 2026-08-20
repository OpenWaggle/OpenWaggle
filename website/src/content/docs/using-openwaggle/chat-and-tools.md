---
title: "Chat & Tools"
description: "How Pi-backed project sessions and native tool events work in OpenWaggle."
order: 1
section: "Using OpenWaggle"
---

## Sessions

OpenWaggle uses project-scoped sessions. The sidebar groups sessions under project sections; there is no separate global Chats section.

To start work:

1. Select a project folder.
2. Create or select a session under that project.
3. Pick an enabled provider-qualified model in the composer.
4. Send a message.

Session branches are Pi session branches inside a session, not Git branches. Use the right-side [Session Tree](/docs/using-openwaggle/session-tree) to inspect and navigate the full Pi node graph.

## Messages

Assistant output streams from Pi session events. OpenWaggle projects those events into a renderer-friendly transcript with:

- Markdown text.
- Thinking blocks when Pi emits thinking events.
- Tool call blocks when Pi emits tool activity.
- Errors and stop/cancel state from the active run.

## Native Pi Tools

Pi owns active tool selection. OpenWaggle does not pass an explicit allowlist to Pi. With the current Pi SDK defaults, the initial built-in tools are `read`, `bash`, `edit`, and `write`; OpenWaggle also renders Pi search/listing tools when Pi enables or emits them.

| Tool | Purpose |
|------|---------|
| `read` | Read file contents. |
| `write` | Create or replace files. |
| `edit` | Apply file edits. |
| `bash` | Run shell commands. |
| `grep` | Search file contents. |
| `find` | Find files. |
| `ls` | List directory contents. |

Pi owns tool execution. OpenWaggle renders the resulting events directly in the transcript.

## Slash Command Menu

Type `/` anywhere a new composer token can start. Keep typing to filter the menu, then use the arrow keys and `Enter` to select an item without leaving the composer.

Current slash-command-menu uses include:

- Skill references.
- Waggle presets.
- Slash contributions from enabled extensions.

Selecting a skill or Waggle preset replaces only the active slash token. Existing prompt text remains intact, and the selection renders as a chip before the message is sent. Waggle presets apply to one send rather than enabling a sticky mode.

## Global Command Palette

Press `Cmd+K` / `Ctrl+K` for the centered application palette. It includes new sessions, compaction, projects, recent sessions, session operations, settings, view toggles, extension actions, feedback, file search, and content search. Prompt skills and Waggle presets remain in the composer-native `/` menu. You can also type `/compact` directly when you want to include custom compaction instructions.

Use `Cmd+P` / `Ctrl+P` to go directly to fuzzy project file search. Opening a result shows the project explorer and file on the right. Text files support autosave with external-change detection; Markdown and HTML support safe previews, while images and PDFs render in place. Content-search results open at the matching line.

## Error Handling

When something fails, OpenWaggle shows a structured error panel with the message, details, copy action, settings shortcut for auth errors, and retry/dismiss controls where relevant.

If the app closes while a run is active, OpenWaggle does not auto-resume it on restart. It refreshes the latest Pi session snapshot, marks the affected session branch as interrupted, and shows a compact inline notice when you open that branch. Dismissing the notice or sending a new message from that branch clears the indicator.

## Command Environment

The integrated terminal uses OpenWaggle's filtered terminal environment. Pi's `bash` tool follows Pi SDK runtime behavior and currently receives Pi's shell environment, not OpenWaggle's terminal filter.
