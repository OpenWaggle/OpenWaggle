---
title: "Conversations and tools"
description: "Give the agent a task, follow its tool activity, and continue work in a project conversation."
order: 1
section: "Using OpenWaggle"
kind: "guide"
---

A session is a conversation about work in a project. It keeps your messages, the agent's replies and a record of every tool the agent used, so you can come back to it later instead of explaining the task again. This page covers the everyday work: starting a session, reading what the agent does, and steering it while it works.

## Start a session

1. Select your project in the sidebar and choose **New session**, or open a session you already have.
2. For a new session, choose **Current checkout** or **New worktree** above the message box. See [Projects and worktrees](/docs/developer-workflow/projects-and-worktrees) if you're not sure which you want.
3. Pick a model beside the message box. If a model is listed under several providers, pick the provider you connected.
4. Describe the result you want, the files or behavior involved, and anything the agent must leave alone.

For example:

```text
Find where this app validates email addresses.
Explain the current behavior and suggest a test for an address with surrounding spaces.
Don't edit files yet.
```

Around the message box you'll find, from left to right:

- **Current checkout** or **New worktree**, which sets where the session works. The message box doesn't let you change it after the first message. An agent or the CLI can still move a session with `handoff`.
- The branch the session runs on. With **New worktree**, it is the branch the new worktree starts from. See [Choose the run target](/docs/developer-workflow/git-integration#choose-the-run-target).
- **+**, to attach files, reference a project file, use a skill, start a Waggle preset, or turn MCP servers off for this session. See [Attachments and voice input](/docs/using-openwaggle/attachments-voice).
- The access mode, such as **Ask for approval**, which decides whether protected actions ask you first. See [Approvals and permissions](/docs/configuration/approvals-permissions).
- The model picker, which lists the models you turned on.
- The thinking level, which sets how much reasoning the model does. See [Thinking levels](/docs/configuration/thinking-levels).
- The context meter, which shows how much of the model's context window the session uses. See [Context management](/docs/using-openwaggle/context-management).
- The microphone, to dictate a message. See [Voice input](/docs/using-openwaggle/attachments-voice#dictate-a-message).

Keep related work in one session and start another for an unrelated task. Sessions that all use **Current checkout** edit the same files, so a new session on its own doesn't keep their changes apart.

Sessions you start with the `pi` command in a project folder show up in that project too, and you can continue them here. See [sessions from the Pi CLI](/docs/using-openwaggle/pi-cli-sessions).

### Change the model

You can switch a session to another model at any time with the model picker. The session keeps the new model, also after you restart OpenWaggle. Only that session changes. Other sessions keep their models, and new sessions still start with the project's default.

If the agent is working when you switch, the current turn finishes on the model it started with. A note above the message box says which model your next message will use. It disappears once your next message, or a message you queued, starts on the new model.

## Name and share sessions

### Session titles

A new session first shows your opening message as its title. A second or two later, OpenWaggle replaces it with a short generated title such as "Fix sidebar row overlap", so you can find the session again weeks later. Workers get their titles the same way, from the task they were given.

After that the title stays. If your first message was too vague to name, such as "fix this" or a bare screenshot, OpenWaggle titles the session once more after the agent's first reply. It never retitles a session as the conversation goes on, and a new title never moves a session in the sidebar.

To rename a session, double-click its title in the sidebar or the header, press F2 on a focused row, or choose **Rename session** from the row menu. Press Enter or click away to save, or Escape to cancel. OpenWaggle never replaces a title you chose. **Regenerate title** in the same menu asks for a new title based on the whole conversation and applies it right away.

The **Title model** in **Settings > Connections** writes the titles. By default it is the cheapest available model from the same provider and model family as the session, in the same region. For example, it is Claude Haiku for a Claude Sonnet session on Amazon Bedrock. Your message goes nowhere it wasn't already going. Choose **Off** to keep the opening message as the title.

If the **Title model** fails, the session's own model writes the title. If the provider refuses the **Title model**, for example because your account can't use it or its sign-in expired, OpenWaggle tells you once. For the next 30 minutes it titles new sessions with their own model and doesn't try the refused one. **Regenerate title** still tries the **Title model** first.

### Session links

Every session has a link, such as `openwaggle://sessions/4bc96a8e-3b0a-456f-8ac3-64b8be7dc940`, that you can give to another session so its agent can look at this one. To copy it, do one of these:

- Choose **Copy session link** from the session's row menu in the sidebar or the Hive panel.
- Choose **Copy session link** in the command palette.
- Press `Cmd+Option+L` on macOS or `Ctrl+Alt+L` on Windows and Linux to copy the link of the session you have open. The shortcut works in the terminal too.

A new session has no link until you send its first message.

Some Linux desktops, such as Xfce, Cinnamon and MATE, lock the screen on `Ctrl+Alt+L` before OpenWaggle sees it. On some keyboard layouts, such as Polish on Windows, `Ctrl+Alt+L` types a letter, and while you type in a field, in the terminal or anywhere in a Browser preview page, the letter goes there instead. If either gets in your way, pick another key for **Copy session link** in **Settings > Shortcuts**.

Paste the link into another session's message, for example "Check what the session at openwaggle://sessions/… decided about the schema". The agent reads that session with its `hive` tool, which takes the link as it is. The [Hive CLI](/docs/developer-workflow/hive-cli) accepts a link anywhere it takes a session id. A worker, or an agent limited to one project, can still be refused a session outside its Hive or project, just as with a session id.

Clicking a session link in a conversation opens that session. With an installed release, a link opened anywhere else on your computer, such as in a chat app or a note, opens it too. On Linux, the [install script](/docs/getting-started/installation) registers OpenWaggle for these links. If you installed an earlier release, run the script again. When a link opens:

- An archived session opens with its archived notice and stays archived until you restore it.
- If OpenWaggle doesn't have the session, for example because it was deleted or the link came from a development build, it says the session wasn't found and stays on the page you were on.
- Opening a link only shows the session. It never sends a message, starts the agent or changes the session.

Development builds keep their own sessions, so they never answer links opened outside the app. Links clicked inside a development build still open its own sessions.

## Read the sidebar

The sidebar groups sessions by project. Each row shows a title, the session's state and a timestamp. Hover over a row to see its actions. The timestamp stays visible.

![The sidebar with state chips above the jotter project, and jotter sessions that are in error, working, waiting for input, done and interrupted](/screenshots/sidebar-states.png)

### What a row's state means

| State | Meaning |
|-------|---------|
| Input | The agent needs an answer from you. |
| Working or Connecting | Work is in progress. The row may also name the activity, such as Testing. |
| Interrupted | Work stopped before it finished. Open the session to decide how to continue. |
| Error | A request or action failed. Open the session for details. |
| Waggle | A Waggle review with two agents is running. |
| Done | Work finished while you were away. |

An idle session has no state label. Sessions that need you also have a colored marker on their edge, but the label alone tells you the state.

### What the icons mean

Hover an icon for details about where the session works:

| Icon | Meaning |
|------|---------|
| Crown | The session is a Hive's Queen. The count beside it is its direct workers. See [Hives and sessions](/docs/using-openwaggle/hives-and-sessions). |
| Pickaxe | The session is a Hive worker. A count beside it is the workers it started itself. |
| Branch | The tooltip names the Git branch. |
| Split | The session works in its own worktree, not in the folder you opened. |
| List tree | The conversation has more than one branch. The count is beside it. |
| `↑n` `↓n` | Commits ahead of and behind the branch's upstream. |

Conversation branches are other paths through the conversation, not Git branches. The [Session Tree](/docs/using-openwaggle/session-tree) shows them.

### Filter the list

Type in the sidebar filter to match session titles and project names. `Cmd+F` on macOS or `Ctrl+F` on Windows and Linux moves to the filter, and `Escape` clears it while it has focus.

The state chips below the filter show how many sessions are in each state. Select one to find those sessions in every project, including collapsed ones. A collapsed project's heading also shows how many of its sessions are working or need you.

Filters reset when you quit. OpenWaggle remembers the sort order and which projects you collapsed.

## Follow the agent's work

Replies appear as the model writes them. A conversation can include formatted text, the model's thinking when it shares it, tool calls and errors.

A tool is something the agent does outside its reply, such as reading a file or running a test. Read the tool rows as well as the final answer. The command the agent ran and its output tell you more than the agent saying the tests passed.

Each tool row starts with an icon for the kind of tool: a terminal for shell commands, a file for reads, a pickaxe for workers (also the Hive panel's icon for a worker without an agent definition), the MCP logo for MCP tools, a pointer for the browser preview, and so on. A row whose label shimmers is still running. A failed call keeps its text, turns its icon red and ends with **×**. A finished call has no extra mark. An MCP tool shows its server and tool name, such as **Datadog › search_datadog_logs**.

When the agent coordinates [workers](/docs/using-openwaggle/hives-and-sessions), each row names the worker by its current title and agent definition, such as **Spawned Worker (reviewer) · Review the diff** or **Messaged Worker · Check main process**. A worker the agent started itself also shows the worker's state, worded as in the Hive panel, and an **Open** button. Waiting for workers adds no row. The spawn rows and the Hive panel show what the agent is waiting for.

![Tool rows from one turn, with a shell command, a failed read and its error, an edit with its diff, an MCP search and a spawned worker](/screenshots/tool-rows.png)

Expand a tool row to see its arguments and output. Shell output can appear while the command is still running, and a live excerpt shows progress, not success. A failed command keeps the output it produced. Use **Copy command** or **Copy output** when they are there.

Expanding a successful edit shows that file's diff instead of the raw edit arguments. Select the file name to open the file at the first change, or use **Copy diff**, **Copy path** or **Copy args**. Output an extension adds to the edit, such as diagnostics, appears under the diff with **Copy output**. A failed edit shows its arguments and the error. To review everything a turn changed, use the changed-files card or the [diff panel](/docs/developer-workflow/git-integration#open-the-diff-panel).

A session's first message reports each setup step in the conversation, such as pulling the branch, creating a worktree, or connecting an MCP server it has to wait for. **Worktree created** means the checkout exists, not that project setup or the task is done. A setup command you configured must finish before the agent's first turn. See [Watch the worktree being created](/docs/developer-workflow/projects-and-worktrees#watch-the-worktree-being-created) for what each step means.

If the agent asks for approval, check what it wants to do and to what. Choose **Allow once** to let it go ahead, or **Continue without** to skip it and say what to do instead. **Ask for approval** doesn't ask before every file read, and it doesn't stop the agent from editing files. See [Approvals and permissions](/docs/configuration/approvals-permissions).

## Send a message while the agent works

You can send a message while the agent is busy. It doesn't start a second task alongside the first. It waits as a follow-up and runs when the current work ends. To correct changes already made to files, review them in the [diff panel](/docs/developer-workflow/git-integration#open-the-diff-panel) and send comments from there.

Queued follow-ups wait above the message box, in the order they will go. Each one has these controls:

- **Steer** sends the message into the work that is running now. The agent reads it at its next step. It doesn't stop a tool that is already running.
- The pencil edits the message, and the bin deletes it.
- **Pause** above the list holds the whole queue until you resume it.

![Two queued follow-ups above the message box while the agent works, each with a grip, Steer, edit and delete, and Pause above them](/screenshots/queued-follow-ups.png)

To reorder the queue, drag a message by its grip, the dots at its left edge. The message follows the pointer, its old place stays dimmed, and a line shows where it will land. Press `Esc` or drop it outside the list to keep the old order. You can also click the grip, or focus it and press `Enter`, and choose **Move up** or **Move down**.

[Hives and sessions](/docs/using-openwaggle/hives-and-sessions) explains how follow-ups and steering work between sessions.

## Tools the agent can use

### Pi's file and shell tools

Pi is the agent that runs inside OpenWaggle. Its usual starting tools are:

| Tool | What it does |
|------|--------------|
| `read` | Reads a file. |
| `write` | Creates or replaces a file. |
| `edit` | Makes targeted edits to a file. |
| `bash` | Runs shell commands, including searches and tests. |

Other tools, such as `grep`, `find` and `ls`, may be there too, depending on your setup. An agent definition can limit a session to a list of tools, so not every session has the same ones. For running several tool calls from one script, see [Codemode](/docs/using-openwaggle/codemode).

### Project actions

The agent can find and run your saved [Project actions](/docs/configuration/project-actions), such as your test command or dev server, within its usual permissions. Saving an action doesn't give the agent extra permission to run it. These runs, with their output and controls, appear in **Session Summary > Actions**, apart from the interactive terminal.

### Browser preview tools

The agent can look at and use the same [Browser preview](/docs/developer-workflow/browser-preview) you use. For example, ask it to open your running app, check a page at phone width, and report what it finds. Actions that change the page go through approvals. If you type or click in the preview, the agent's action stops so you can take over.

To turn this off, clear **Settings > Browser > Let agents open and drive the preview browser**. Later turns lose preview access, and OpenWaggle refuses the next preview calls of a turn already running. Your own browser controls keep working. If OpenWaggle can't read the setting, agents get no preview access.

## Use the slash menu

Type `/` at the start of a word in the message box. Keep typing to filter, then use the arrow keys and `Enter` to choose.

![The slash menu over a new session's message box, with the built-in commands, then skills such as Visualize, then Waggle presets](/screenshots/slash-command-menu.png)

The menu lists the built-in commands `/compact`, `/fork` and `/clone` first, then skills, saved Waggle presets, and commands from enabled extensions. A skill gives the agent instructions for one kind of task. A Waggle preset sets up a review by two agents.

In a session, the menu also lists the commands its Pi extensions add, such as Pi's `/mcp`, with their descriptions. Choosing one puts it in the message box. When you send the message, Pi runs the command instead of sending the text to the model. A session's title never comes from such a command, only from the first real request.

When a built-in command such as `/compact` is the whole message, `Enter` runs it. `Tab` or a click always completes the command so you can type after it, such as instructions for compaction. `Enter` completes it too when the message has other text.

Choosing a skill or preset replaces only the slash word and keeps the rest of your draft. It shows as a chip until you send. A Waggle preset applies to that one message, not to every message after it.

`/compact`, `/fork` and `/clone` need the session to be idle. If the agent is working, wait for it to finish and send the command again. OpenWaggle keeps your draft and attachments when it refuses one of these commands. Ordinary messages, skills and Pi extension commands can still wait in the queue as follow-ups.

## Use the command palette

Press `Cmd+K` on macOS or `Ctrl+K` on Windows and Linux to find any app action: new sessions, switching project, recent sessions, settings, view controls, file and content search, panels, and actions from extensions. Skills and Waggle presets are in the message box's `/` menu instead.

![The command palette open, with its search field and commands for new sessions, projects and the open session](/screenshots/command-palette.png)

The **Panels** section lists every panel the right panel can show: All panels, Changes, Project Actions, Scheduled, Browser, Files, Session Tree, Resources, Hive, and each extension side panel that can run, with its extension's name. Each entry shows its shortcut if it has one. Choosing a panel shows it in the right panel and never closes the right panel, even when that panel is already showing. To give a panel a shortcut, see [Panel shortcuts](/docs/getting-started/keyboard-shortcuts#panel-shortcuts).

Press `Cmd+P` or `Ctrl+P` to search for a project file, and select a result to open it on the right. Text files save as you type and notice changes made outside the editor. Markdown and HTML have safe previews, and images and PDFs show in place. Content search results open at the matching line.

## When something fails

When an action fails, an error panel shows the message and details. Copy them when you report a problem. Sign-in errors can link to Settings, and retry and dismiss buttons appear where they help.

Closing or restarting the app doesn't stop the agent. Runs belong to a background process, the Session Host, which keeps them going. Reopen the app to see how far they got. So closing the window is not a way to stop work. If a run really was interrupted, check its last tool results and your files before you ask the agent to continue. [How OpenWaggle works](/docs/getting-started/how-openwaggle-works#the-session-host) explains the Session Host.

## Share terminal output with the agent

The [built-in terminal](/docs/developer-workflow/built-in-terminal) is for commands you run yourself. It starts your usual shell, with your shell configuration, in the session's working directory. The agent's `bash` tool starts its own shells and doesn't use the terminal panel.

To give the agent some terminal output, select it, right-click, and choose **Add selection to chat**. A chip with the terminal and working directory appears in the message box, and you can remove it. Check it and send your message when you're ready. Selecting output on its own sends nothing, and OpenWaggle marks the output as untrusted, so the agent treats it as data rather than instructions.
