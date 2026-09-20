---
title: "Chat & Tools"
description: "How Pi-backed project sessions and native tool events work in OpenWaggle."
order: 1
section: "Using OpenWaggle"
---

## Sessions

OpenWaggle uses project-scoped sessions. The sidebar groups sessions under project sections; there is no separate global Chats section.

## Reading the sidebar

Each session is two lines. The first is the title alone, so long names stay readable. The second
carries everything else, and the parts of it behave differently on purpose: what is on the left
truncates when space runs short, while the shortcut badge and the timestamp on the right never do.

The timestamp does not disappear when you hover a row. Row actions appear over the first line
instead, so nothing you were reading moves as the pointer arrives.

### What a row tells you

A coloured icon leads the row and the same colour names the state in words on the line below:
`Input` when the agent is
waiting on you, `Interrupted` when a run stopped partway and can be resumed, `Error` when a run
failed, `Working` or `Connecting` while it is busy, `Waggle` during a Waggle review, `Done` when it
finished while you were away. Rows that need a person also carry a coloured bar on their left edge,
so the state is never carried by colour alone. Idle sessions say nothing.

While a session is working, the row also names what the agent is doing, such as `Refactoring` or
`Testing`.

### Provenance icons

Small muted icons say what kind of session it is, rather than what it needs. Hover any of them for
the detail.

| Icon | Meaning |
|------|---------|
| Branch | The git branch the session works on. The name is in the tooltip, not the row. |
| Split | The session runs in its own worktree rather than the folder you opened. |
| List tree | The session's conversation has more than one branch, with the count beside it. |
| `↑n` `↓n` | Commits ahead of and behind upstream. |

### Narrowing the list

The filter field at the top matches session titles and project names. `Cmd+F` focuses it and
`Escape` clears it.

Beneath it, a chip appears for each state that something is actually in, with a count. Clicking one
shows only those sessions, across every project rather than only the one you have open, so a failed
run in a collapsed project is one click away. Chips stay visible while a filter is active, so
switching to another state is also one click. Filters are deliberately forgotten when you quit:
sorting and collapsing are remembered, but a filter that hides sessions should not outlive the
reason you applied it.

A collapsed project still reports what is inside it, as small counted pips on its heading for the
states that need attention or are in flight.

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

## Browser Preview Tools

When **Settings > Browser > Let agents open and drive the preview browser** is enabled, Pi also
receives OpenWaggle's trusted `preview_*` tools and concise instructions for using them. These tools
operate on the active Session's own [Browser preview](/docs/developer-workflow/browser-preview), not
on a separate headless browser. They can open or reuse a tab, navigate, resize, inspect a bounded
snapshot, interact with the page, and capture screenshots or recordings.

Page-changing calls use the same scoped approval flow as other agent capabilities. User and agent
controls share one serialized browser controller, and real keyboard or pointer input interrupts an
agent action. Disabling the setting removes both the tools and their instructions from subsequent
turns and rejects any later preview call from a turn already in progress; a settings read failure
has the same fail-closed result.

## Slash Command Menu

Type `/` anywhere a new composer token can start. Keep typing to filter the menu, then use the arrow keys and `Enter` to select an item without leaving the composer.

Current slash-command-menu uses include:

- Skill references.
- Waggle presets.
- Slash contributions from enabled extensions.

Selecting a skill or Waggle preset replaces only the active slash token. Existing prompt text remains intact, and the selection renders as a chip before the message is sent. Waggle presets apply to one send rather than enabling a sticky mode.

## Global Command Palette

Press `Cmd+K` / `Ctrl+K` for the centered application palette. It includes new sessions, compaction, projects, recent sessions, session operations, settings, view toggles, extension actions, feedback, file search, and content search. Prompt skills and Waggle presets remain in the composer-native `/` menu. You can also type `/compact` directly when you want to include custom compaction instructions.

The composer commands `/compact`, `/fork`, and `/clone` require an idle Session. If a Run is active, wait for it to finish and submit the command again. OpenWaggle keeps your draft and attachments when it refuses to queue one of these commands. Ordinary messages, skill prompts, and Pi extension commands can still be queued as Follow-ups.

Use `Cmd+P` / `Ctrl+P` to go directly to fuzzy project file search. Opening a result shows the project explorer and file on the right. Text files support autosave with external-change detection; Markdown and HTML support safe previews, while images and PDFs render in place. Content-search results open at the matching line.

## Error Handling

When something fails, OpenWaggle shows a structured error panel with the message, details, copy action, settings shortcut for auth errors, and retry/dismiss controls where relevant.

If the app closes while a run is active, OpenWaggle does not auto-resume it on restart. It refreshes the latest Pi session snapshot, marks the affected session branch as interrupted, and shows a compact inline notice when you open that branch. Dismissing the notice or sending a new message from that branch clears the indicator.

## Command Environment

The built-in terminal and Pi's `bash` tool have different launch policies. A Session terminal starts
the user's interactive shell in the session's Working path, loads normal startup configuration, and
inherits the user's environment after narrow Electron/OpenWaggle launch cleanup. Pi's `bash` tool
follows Pi SDK runtime behavior instead.

To give terminal output to the agent deliberately, select it and use **Add selection to chat** from
the terminal context menu. OpenWaggle adds a removable, bounded, provenance-labelled context chip
to the composer and marks it as untrusted terminal output. Selecting output does not send anything
by itself.
