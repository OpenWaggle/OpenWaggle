---
title: "App settings"
description: "Find settings for models, permissions, appearance, browser previews, and project tools."
order: 8
section: "Customize"
kind: "guide"
---

Settings is where you connect models, decide how much the agent may do on its own, and adjust how OpenWaggle looks and behaves. Click **Settings** at the bottom of the sidebar to open it. For a first setup you need two sections: **Connections** to connect a model, and **Permissions** to choose an access mode. Leave the rest alone until you need it. The [Settings reference](/docs/reference/settings) lists every setting, with its values and default.

Most settings apply to the whole app. A few sections have a project picker so you can look at one project's settings. Picking a project there does not switch your conversation to it, so check which project is selected before you change something.

The [Settings reference](/docs/reference/settings) goes through every section in the order the sidebar shows them, with each setting's values and default. The sections below cover the changes people make most.

## Connect a model

In **Connections**, expand **API Key Providers** to save a key or **OAuth Providers** to sign in through your browser. Then turn on the models you want under **Available Models**. The model selector beside the message box shows the models that are turned on and available through a connected provider. See [Providers and models](/docs/providers/overview).

Turning a model on only adds it to the selector. A session that already uses another model, for example one you continue from the `pi` CLI, keeps that model as long as its provider is signed in, the same way `pi --resume` does. If the session's model is gone, such as a virtual model whose extension you removed, the session continues on the model that answered last and the run says so. If the provider is not signed in or the project does not have the model, sending a message tells you which model is missing and where to connect it. A model you turned on from one project's extensions stays on when you open another project, but it shows only where that project's model list has it.

**Title model** chooses which model writes [session titles](/docs/using-openwaggle/chat-and-tools#session-titles). **Automatic** uses the cheapest model from each session's own provider. Choosing a specific model sends each session's opening message to that model's provider. The [Settings reference](/docs/reference/settings#connections) lists exactly what each choice sends.

## Choose how much the agent can do alone

Open **Permissions** and set **Default access mode**. **Ask for Approval** makes the agent ask before protected actions. It is not a read-only mode. The shipped default is **YOLO (Full Access)**. A project can have its own mode under **Selected project**, and **Use default** removes it. See [Approvals and permissions](/docs/configuration/approvals-permissions).

## Let agents share work

In **Agents**, **Agent-created Workers** lets an agent start other sessions to share a task. A worker is a separate conversation with its own messages and tool activity. Read [Hives](/docs/using-openwaggle/hives-and-sessions) before you turn on parallel work.

**Agents** has two limits, both for workers. **Workers per parent** allows 4 runs at a time by the parent's direct workers, and **Active Workers** allows 16 worker runs at a time across the whole app, counting the runs of sessions agents launch, create or fork and the runs agents start in your sessions. A run is one stretch of agent work, not a saved conversation, so saved sessions and queued follow-ups do not count. Your runs in sessions you made never count either, and a message you send, a new session or a reply to a Queen is never refused because of the limits. When a new worker run would pass a limit, OpenWaggle refuses it with an error the agent can retry instead of queuing it. A run OpenWaggle starts for a parent whose workers reported is retried when another run ends, as the [Hive reference](/docs/reference/hive#run-limits) describes. You can raise the limits, but more runs at once can slow your computer and use up your provider quota faster.

A project's `.openwaggle/settings.json` can set its own values for **Agent-created Workers** and **Workers per parent**, and the file wins. If an older version saved per-project values in the app, **Saved project overrides** shows them and **Clear saved value** removes them. Clearing does not change a project file. See [Per-project configuration](/docs/configuration/per-project-config).

Below the limits, pick a project to read its agent definitions, and turn each one on or off for new sessions. OpenWaggle has no built-in roles and no editor for them. You write the Markdown files in your project. See [Agent definitions](/docs/extending/agent-definitions).

## Control compaction and the agent's tools

**General > Context compaction** sets when OpenWaggle shrinks the older part of a long conversation so it can continue. **Automatic compaction threshold** starts at 80% of the model's context window, and compaction runs by 400,000 tokens at the latest, whatever the percentage. The setting covers every model, project and session. The model decides whether compaction uses the provider's own method or a portable summary. There is no switch for that. See [Context and compaction](/docs/using-openwaggle/context-management).

**General > Agent tools** has two settings that OpenWaggle passes to Pi:

- **Codemode** lets the agent write a short script that calls several tools in one step. It is on unless you turn it off. Each tool the script calls still asks for approval when it normally would. See [Codemode](/docs/using-openwaggle/codemode).
- **Keep prompt caches warm** decides whether Pi resends the conversation during long tool calls, so the provider keeps it cached and the next request does not pay to rebuild it. **While working**, the default, refreshes only when Pi expects the refresh to save more than it costs. **Off** never refreshes. **Between runs** also keeps refreshing for up to 30 minutes after the agent finishes, in case you reply. Pi expects a reply less often than a next tool call, so it refreshes less often then.

Cache refreshes stop when you start a new run, compact, branch, archive or delete the session, or quit OpenWaggle. They count toward the session's usage and show in the context meter's session cost the next time it updates.

Until you change these two here, they follow `defaultTools` and `cacheWarming` in your own `~/.pi/agent/settings.json` if you set them there. OpenWaggle reads your Pi settings again for each run, so a change there applies to the next run. Once you choose in OpenWaggle, your choice wins, and OpenWaggle never writes it to Pi's files. The Pi command line keeps its own choices.

## Continue sessions from the pi CLI

**General > Pi sessions** lists your projects. For each one, choose what happens when you send in a session that the `pi` CLI used last: **Ask** (the default), **OpenWaggle** to continue it here without asking, or **pi** to open the session's terminal with the `pi` command typed in. OpenWaggle stores the choice in your own settings, not in the project, so everyone on the project chooses for themselves.

## Update OpenWaggle

**General > About & Updates** shows your version and **Update channel**. Until you choose a channel, a Stable build follows Stable, an Alpha or Beta build follows its own channel, and a release candidate follows Beta. Beta also gets release candidates and Stable releases. Alpha gets Alpha, Beta, release candidate and Stable releases. Switching to Alpha asks you to confirm first.

Changing the channel saves it and checks for an update straight away. It never installs an older version. Until the first Stable release is out, Stable has nothing to install and says you are up to date. The app and `openwaggle update` share the channel setting.

Click **Check now** to check again. A downloaded update installs only when you click **Restart to update**. Quitting the app the normal way does not install it. Before restarting, OpenWaggle checks again that the update fits your channel.

If agent runs are still working when you click **Restart to update**, OpenWaggle asks what to do. **Restart when idle** waits and installs as soon as no run is active, and the status line says how many runs it is waiting for. **Restart now** stops the runs and installs. **Cancel** leaves the runs going and installs nothing.

While the update installs, OpenWaggle stops its background Session Host and quits. It reopens on its own once the update is in place, usually within a few seconds. If you open it yourself before then, the install fails. On macOS an update cannot install while another OpenWaggle process is running, such as `openwaggle mcp serve` used by another agent or `openwaggle hive wait` in a terminal. When an update did not install, OpenWaggle tells you why shortly after it next opens, once the update is ready again. Close the other process and click **Restart to update** again.

See [Installation](/docs/getting-started/installation) for installing and updating from the command line.

## Turn off usage statistics

**Share anonymous usage statistics and error reports**, under the update channel, is on in released builds. Turning it off stops both and deletes statistics that have not been sent yet. In a Dev build, during an automated test launch, or when `DO_NOT_TRACK`, `PI_TELEMETRY` or `CI` turns statistics off, the switch shows off, you cannot change it, and it says why. Your saved choice applies again once none of those holds. **What is sent** opens [Usage statistics and error reports](/docs/configuration/usage-statistics), which lists every field and the other ways to turn them off.

## Check the command-line tool

The `openwaggle` command comes with the app. On macOS and Linux, opening the packaged app installs or refreshes `~/.local/bin/openwaggle`. On Windows, the installer adds the command. Make sure the install folder is on your shell's `PATH`.

**General** shows a warning if the command is missing, out of date, blocked by another file, or not on `PATH`. There are no install buttons. OpenWaggle never replaces an unrelated file at the command's path, so you have to move that file yourself. An older macOS link straight to the app still works, but run the installer again if you move the app. When you run OpenWaggle from source, use `bun run cli:dev -- <command>`.

## Change how OpenWaggle looks

**Appearance** changes how things read without touching your code. Pick syntax themes for light, dark and high-contrast appearances, set terminal colors, and choose fonts and sizes for the interface, documents, code and the terminal. **Diff layout** switches between **Unified** and **Side by side**, and **Wrap long lines** stops sideways scrolling in diffs. The diff panel's own controls change the same two settings. **Reduce motion** keeps animation to a minimum instead of following your operating system. These choices apply in every project, and no project file can change them.

## Set up the preview browser

In **Browser**, **Let agents open and drive the preview browser** decides whether agents get the browser tools at all. It is separate from where links open.

**New preview tabs use** picks the browser profile new tabs start with. **Default** and the profiles you add keep cookies and site data. **Incognito** keeps them only in memory. Before you let an agent use a profile, check what the logins you imported into it allow. The other defaults are **Viewport**, **Zoom**, **Appearance**, **Recording** and **Show agent-opened previews**. See [Browser preview](/docs/developer-workflow/browser-preview) and [Security and privacy](/docs/configuration/security-privacy).

## Save project commands and shortcuts

**Project actions** saves commands such as tests and builds, or a dev server that keeps running, and sets up what runs when OpenWaggle creates a worktree. You start actions from **Project Actions** on the right panel rail. See [Project actions](/docs/configuration/project-actions).

**Shortcuts** covers both app keyboard shortcuts and project action shortcuts. **Add binding** lets you pick either kind of command. Check the overlap warning before you take a shortcut that something else already uses. See [Keyboard shortcuts](/docs/getting-started/keyboard-shortcuts).

## Clean up worktrees

**Worktrees** lists the session worktrees of every project, how much space each takes, and which ones you can remove. Removing a worktree deletes its folder, including ignored files such as `.env` and `node_modules`. Its branch is always kept.

**New Sessions run in** sets where new sessions work. **Current checkout**, the default, edits the project folder you opened. **A new worktree** gives the session its own Git checkout. You can still change it for one session before its first message. See [Reviewing changes and Git](/docs/developer-workflow/git-integration).

![Settings > Worktrees with the storage summary, the Automatic cleanup setting, and two worktrees In use, each with its session, branch, size and Archive & remove](/screenshots/settings-worktrees.png)

The storage card adds up the space each worktree would free. OpenWaggle measures sizes in the background, and each shows **Measuring…** until it arrives. They are estimates. Files shared with another folder, such as a pnpm package store, do not count, because removing the worktree would not free them. **Free about X** removes every worktree in **Safe to remove** after one confirmation that lists them.

OpenWaggle sorts worktrees into three groups:

- **Safe to remove** holds worktrees whose every change is committed and pushed to a remote, and that no open session uses. **Remove** asks once more in the row, then removes it.
- **Needs a decision** holds worktrees with uncommitted changes or commits that are on no remote, worktrees made outside OpenWaggle, and worktrees that are locked, whose cleanup failed, or whose state Git could not report. **Discard & remove** or **Remove** opens a confirmation that says what you would lose.
- **In use** holds worktrees that an open session, a run, a terminal or a project action uses. This group starts collapsed. **Archive & remove** archives every session in the worktree and then removes it, and the confirmation names each session. It never throws away uncommitted changes. A worktree that has some offers **Archive Sessions** instead, which archives the sessions and keeps the worktree. While it still has changes it is listed under **Needs a decision**, where **Discard & remove** is a separate step. **Archive & remove** is not available while a run, terminal or action uses the worktree, and the row says which.

Worktrees that OpenWaggle manages appear for every project. Worktrees made outside OpenWaggle appear only for the project you opened, under **Needs a decision** unless something uses them, because removing one also deletes ignored files such as `.env` that OpenWaggle cannot bring back. A worktree in OpenWaggle's worktree folder that this OpenWaggle profile has no record of, for example one a development build made, reads **Not recorded by this OpenWaggle profile** and also needs a decision. A managed worktree that no session uses reads **No Session uses this worktree**, and you can only remove it by hand. Use the project picker and search to narrow a long list.

Archiving a session keeps its worktree, so restoring the session is instant. If you remove an archived session's worktree and restore the session later, its next message offers to recreate the worktree from the kept branch or to continue in the current checkout.

### Remove worktrees automatically

**Remove worktrees of archived Sessions automatically** is off until you turn it on. Then OpenWaggle removes a managed worktree, in every project, once every session in it has been archived for the number of days you choose under **After archiving for**: 7, 14, 30, 60 or 90, with 30 to start. It checks when the app starts and about once a day after that. It never removes a worktree with uncommitted changes, commits on no remote, a failed cleanup or a lock. Those stay under **Needs a decision** with the reason. The line beside the setting shows what it would remove right now.

The card shows when the rule last checked, and the last time it removed something, with each session and its kept branch. The rule measures each worktree just before removing it, so it can tell you how much space it freed. After it removes something, the next time you open the app you see one notice with a **View** button that opens this page.

### When removal fails

OpenWaggle checks each removal again just before it runs, so it keeps a worktree that came into use after the list loaded. If cleanup fails, the worktree stays in the list with its output and **Retry cleanup**. **Delete anyway** skips cleanup, which can leave outside resources behind, such as a temporary database. **Force remove** also removes worktrees with changes or a lock and can throw away uncommitted work. Save anything you need before you use it.

## Find and restore archived sessions

**Archived items** lists every archived session, and every archived branch of a session you still use, newest first. Use it to bring back a session you archived by mistake.

- **Search** looks in a session's title, its project, the session a branch belongs to, and the conversation itself. Every word you type has to appear somewhere, and you can leave off the end of a word, so `refac` finds "refactor". A match inside the conversation shows the passage it came from.
- **Project**, **Archived date** (last 24 hours, 7 days, 30 days, or older) and **Type** (sessions or branches) narrow the list. Each option shows how many items you would see if you chose it.
- While you search, the best matches come first. Otherwise the list groups items by when you archived them: Today, Yesterday, Earlier this week and so on. **Sort** switches to newest or oldest first.
- **Restore** puts an item back in the sidebar, and the confirmation offers **Undo**, which archives it again with its original date. You can select several items, Shift-click to select a range, or select every match, up to 1,000 in the order the list shows, and restore them together. Changing the search or a filter clears the selection.
- **Open** shows an archived session without restoring it. It keeps its archived notice and **Restore** button, and stays out of the sidebar until you restore it. Opening a branch opens the session it belongs to.
- **Delete** deletes archived sessions for good after you confirm, once for the whole selection. You cannot undo it. OpenWaggle keeps a selected session that someone restored somewhere else in the meantime, for example in another window. You can restore archived branches here, but not delete them.

The sidebar hides archived branches, and the full Session Tree still marks them.

## Set up MCP servers

MCP connects the agent to tools and services beyond its built-in file and command tools. OpenWaggle reads the same MCP files as Pi, so servers you set up for Pi show up in **MCP** too. Add servers, turn them off or sign in to them there. See [MCP connections](/docs/configuration/mcp).

<a id="logs"></a>

## Find logs and app data

When something goes wrong, the log files are the first place to look. Review them for secrets and private project details before you share them. When agent work fails, the error display can open the logs folder for you. [Data and file locations](/docs/reference/data-locations#logs) lists where OpenWaggle keeps its logs, session database and worktrees on each platform, and [Configuration files](/docs/reference/configuration-files) lists every file it reads settings from.
