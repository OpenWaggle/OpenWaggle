---
title: "Conversations and tools"
description: "Give the agent a task, follow its tool activity, and continue work in a project conversation."
order: 1
section: "Using OpenWaggle"
---

A session is a conversation about work in a project. It keeps your messages, the agent's replies, and a record of the tools it used. You can return to the same session later instead of explaining the task again.

## Sessions

1. Select your project in the sidebar and choose **New session**, or open an existing session.
2. For a new session, choose **Current checkout** or **New worktree** above the message box. See [Projects and worktrees](/docs/developer-workflow/projects-and-worktrees) if you're unsure which to use.
3. Choose a model beside the message box. If a model appears under several providers, choose the provider you connected.
4. Describe the result you want, the files or behavior involved, and anything the agent must leave alone.

For example:

```text
Find where this app validates email addresses. Explain the current behavior
and suggest a test for an address with surrounding spaces. Don't edit files yet.
```

Keep related work in the same session. Start another session for an unrelated task. Multiple sessions using **Current checkout** can edit the same files, so a new conversation alone does not isolate their changes.

## Reading the sidebar

The sidebar groups sessions by project. Each row shows a title, its current state, and a timestamp. Hover a row to see its actions without hiding the timestamp.

### What a row tells you

| State | Meaning |
|-------|---------|
| Input | The agent needs a response from you. |
| Working or Connecting | Work is in progress. The row may also name the activity, such as Testing. |
| Interrupted | Work stopped before completion. Open the session to decide how to continue. |
| Error | A request or action failed. Open the session for details. |
| Waggle | A multi-agent Waggle review is running. |
| Done | Work finished while you were away. |

Idle sessions have no state label. Sessions needing attention also have a colored edge marker, but you don't need to distinguish colors to read the state.

### Provenance icons

Hover these icons for details about where the session works:

| Icon | Meaning |
|------|---------|
| Branch | The Git branch name is in the tooltip. |
| Split | The session uses its own worktree rather than the folder you opened. |
| List tree | The conversation has multiple branches. The count appears beside it. |
| `↑n` `↓n` | Commits ahead of and behind the branch's upstream. |

Conversation branches are alternate paths through the chat, not Git branches. Use the [Session tree](/docs/using-openwaggle/session-tree) to browse them.

### Narrowing the list

Type in the sidebar filter to match session titles and project names. `Cmd+F` on macOS or `Ctrl+F` on Windows and Linux focuses it. `Escape` clears the filters while the field has focus.

State chips beneath the filter show counts. Select one to find matching sessions across all projects, including collapsed projects. Collapsed project headings also show counts for work in progress or needing attention.

Filters reset when you quit. Sorting and collapsed project sections are remembered.

## Messages

Replies appear as the model generates them. The conversation can include formatted text, thinking blocks when the model provides them, tool calls, and errors.

A tool is an action the agent can take outside its reply, such as reading a file or running a test command. Read the tool activity as well as the final answer. An agent saying a test passed is less useful than the actual command and result.

Expand a tool row to inspect its arguments and output. Shell output can appear while the command is still running; a live excerpt is progress, not a success result. Failed commands keep their available output for inspection. Use **Copy command** or **Copy output** when those controls are available.

A new worktree also reports checkout progress in the conversation. **Worktree created** confirms the checkout exists, not that project setup or the task has finished. A configured setup command must complete before the first agent turn. See [First-send worktree feedback](/docs/developer-workflow/git-integration#first-send-worktree-feedback).

If an approval request appears, check the proposed action and its target. Choose **Allow once** to proceed or **Continue without** to skip it and give different instructions. **Ask for approval** does not ask before every file read or guarantee that files cannot be edited.

You can send an ordinary message while the agent is busy. It waits as a follow-up rather than starting a second task at the same time. For changes already made to files, use the [diff panel](/docs/developer-workflow/git-integration#diff-panel) to review them and send corrections.

## Native Pi tools

Pi is the agent engine used by OpenWaggle. Its usual starting file and shell tools are:

| Tool | Purpose |
|------|---------|
| `read` | Read file contents. |
| `write` | Create or replace a file. |
| `edit` | Apply targeted file edits. |
| `bash` | Run shell commands, including searches and tests. |

Other tools, including `grep`, `find`, and `ls`, may be available depending on the active configuration. Tool activity appears in the conversation. Agent definitions can restrict the available tools with an allowlist, so not every session has the same set.

The agent can also discover and use saved [Project actions](/docs/configuration/project-actions), such as your test command or development server, under its existing permissions. These are managed runs with output and controls in **Session Summary > Actions**, separate from the interactive terminal. Saving an action does not grant extra permission to run it.

## Browser preview tools

The agent can inspect and interact with the same [Browser preview](/docs/developer-workflow/browser-preview) you use. For example, ask it to open your running app, check a page at a phone width, and report what it finds.

Control this in **Settings > Browser > Let agents open and drive the preview browser**. Page-changing actions use the approval flow. Your keyboard or pointer input interrupts an agent action so you can take over.

Turning the setting off removes preview access from later turns and rejects further preview calls from a turn already running. Your own browser controls remain available. Agent access is also blocked if the setting cannot be read.

## Slash command menu

Type `/` at the start of a word in the message box. Keep typing to filter, then use the arrow keys and `Enter` to choose an item.

The menu includes skills, saved Waggle presets, and commands added by enabled extensions. A skill supplies instructions for a particular task. A Waggle preset sets up a multi-agent review.

Selecting a skill or preset replaces only the slash token, keeping the rest of your draft. The selection appears as a chip before you send. A Waggle preset applies to that message, not every later message.

## Global command palette

Press `Cmd+K` on macOS or `Ctrl+K` on Windows and Linux to find app actions. The palette includes new sessions, project selection, recent sessions, settings, view controls, file and content search, and extension actions. Use the message box's `/` menu for skills and Waggle presets.

The commands `/compact`, `/fork`, and `/clone` require the session to be idle. If work is running, wait for it to finish and submit the command again. OpenWaggle keeps your draft and attachments when it refuses one of these commands. Ordinary messages, skill prompts, and Pi extension commands can still wait as follow-ups.

Press `Cmd+P` or `Ctrl+P` for project file search. Select a result to open the file on the right. Text files support autosave with detection of changes made outside the editor. Markdown and HTML have safe previews; images and PDFs display in place. Content-search results open at the matching line.

For reducing a long conversation's context, see [Context management](/docs/using-openwaggle/context-management).

## Error handling

When an action fails, the error panel shows the message and details. Use its copy action when reporting a problem. Authentication errors can link to Settings; retry and dismiss controls appear where applicable.

Closing or restarting the desktop app does not interrupt an agent run. A separate background process, the Session Host, keeps runs going. Reopen the app to check progress. If a run is actually interrupted, inspect its last tool results and files before asking it to continue. Closing the window is not a way to stop work.

## Command environment

The [built-in terminal](/docs/developer-workflow/built-in-terminal) is for commands you run yourself. It starts your interactive shell in the session's **Working path** and loads your normal shell configuration. The agent's `bash` tool has its own shell-launch behavior; it is not the terminal panel.

To share terminal output, select it, right-click, and choose **Add selection to chat**. This adds a removable context chip with the terminal and working-path details. Check the chip and send your message when ready. Selecting output alone sends nothing, and OpenWaggle marks it as untrusted output rather than instructions.
