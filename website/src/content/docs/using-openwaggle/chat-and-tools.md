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

## Command Palette

Press `Cmd+K` / `Ctrl+K` or type `/` at the start of the composer input.

Current command-palette uses include:

- Skill references.
- Waggle presets.
- `/compact` for manual Pi compaction.

## Error Handling

When something fails, OpenWaggle shows a structured error panel with the message, details, copy action, settings shortcut for auth errors, and retry/dismiss controls where relevant.

## Command Environment

The integrated terminal uses OpenWaggle's filtered terminal environment. Pi's `bash` tool follows Pi SDK runtime behavior and currently receives Pi's shell environment, not OpenWaggle's terminal filter.
