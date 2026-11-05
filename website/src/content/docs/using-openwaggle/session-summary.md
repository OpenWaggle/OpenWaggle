---
title: "Session Summary and resources"
description: "Check a session's working directory and Git state, follow its Hive, actions and schedules, and find the files, links and images it used or produced."
order: 7
section: "Using OpenWaggle"
kind: "guide"
aliases: "session hub, hub, session resources"
---

The Session Summary is a panel that floats over the right side of a conversation. It shows where the session works, its Git branch and changes, its project actions and scheduled tasks, its Hive, and the files, links and images that went into the conversation or came out of it. Use it to find something from the session without scrolling back through every message, or to commit and open a pull request from the session's own checkout. In OpenWaggle's code and design documents it is called the Session Hub; the app calls it the Session Summary.

![The Session Summary card of a Queen session, with Environment, two scheduled heartbeats, the Hive row, Outputs and Sources](/screenshots/session-summary.png)

## Open and hide the Summary

Click **Open Session Summary** in the header, or run **Toggle Session Summary** from the command palette. The same header button reads **Hide Session Summary** while the panel is open.

The Summary appears once a session has something to show. For an ordinary session that means you have sent its first message. A session in a [Hive](/docs/using-openwaggle/hives-and-sessions), a session with project action or workspace setup activity, and a session with a scheduled Heartbeat show it before that.

It opens by itself when the window has room for it beside the message box, unless you hid it for that session. OpenWaggle remembers, for each session, whether you left the Summary open and which of its sections you expanded. In a narrow window it does not open by itself. Opening it there is temporary: press `Escape` or click outside it to dismiss it, and your choice for wide windows stays as it was. Resizing the window does not clear your message draft, its command chips, or interactive visualizations.

A few things take the Summary's place:

- A right sidebar, such as the diff panel or the Session Tree, hides it. The header button stays visible but is disabled, with the tooltip **Session Summary is hidden while the side panel is open**, until you close that sidebar.
- A floating browser preview keeps the Summary from opening by itself. Opening the Summary yourself hides that session's preview without closing its tab, and hiding the Summary brings the preview back.
- The resource browser and other inspectors keep it hidden. Closing them brings the Summary back if it was open before.

Before a session's first message, opening the diff or a file inspector hides the draft's floating preview, and closing it brings the preview back without creating an empty Summary.

## What each section shows

Sections appear only when they have something to show, in this order. **Sources** is the exception: it is always there, so you can add a source to an empty session.

| Section | What it shows |
| --- | --- |
| **Environment** | The working directory, branch and changes, **Commit or push**, and the pull or merge request for the current branch. |
| **Actions** | Running and recent [project actions](/docs/configuration/project-actions), such as a development server. |
| **Scheduled** | The Heartbeats that run in this session, or the Launch schedule that started it. |
| **Workspace preparation** | Setup progress and output for the session's workspace, with retry and review controls. |
| Pull requests or Merge requests | Other requests this session created. The title starts with **Other** when the current branch's request is already in **Environment**. |
| Extension sections | Sections that [OpenWaggle extensions](/docs/extending/openwaggle-extensions) add, before and after **Hive** and at the end. |
| **Hive** | The session's place in its Hive, and how many of its direct workers need you. |
| **Outputs** | Files, images, sites, commits and requests the session recorded as its results. |
| **Sources** | Attachments, project files, links, tool results and web searches the session used. |

A long list shows its first six items and a row that shows more. An error in one extension's section does not stop the other sections from working.

The Summary does not show agent access or context usage. Those stay beside the message box.

## Check where the session works

Read **Environment** before you run Git commands yourself. It names the checkout the session uses, so you know which files the agent changes.

- **Changes** shows the added and removed line counts. Click it to open the [diff panel](/docs/developer-workflow/git-integration).
- The next row reads **Local** for a session in your current checkout or **Worktree** for a session with its own worktree. Click it to see the working path. The choice is fixed after the first message; start a new session to work elsewhere.
- The branch row opens a branch picker. Type in **Search branches** to find a local or remote branch and check it out, choose **Create** followed by the name you typed to make a new branch, or choose **Copy branch name**. Checking out a branch changes the files of every session that shares this checkout.
- **Commit or push** opens the commit and push panel, described next.
- The **+** at the top of the section has **Toggle terminal**, **Open working folder** and **Copy working path**.

See [Projects and worktrees](/docs/developer-workflow/projects-and-worktrees) for choosing between your checkout and a worktree.

## Commit or push from the Summary

**Commit or push** opens a panel for the session's checkout:

1. Check the staged and unstaged totals and the target branch. You can keep the current branch or type a new branch name, which OpenWaggle checks before using.
2. Decide on **Include unstaged changes**. With it off, a commit uses only what is already staged. With it on, OpenWaggle stages your working-tree changes too.
3. Type a commit message. OpenWaggle does not write one for you in this panel.
4. Choose **Commit** or **Commit & push**. **Push** is there too when there is something to push. `Cmd+Enter` on macOS or `Ctrl+Enter` on Windows and Linux runs the first available action.

A disabled action says what is missing. **Stop after current step** stops a multi-step action before its next step. It does not cancel a commit or a push that is already running.

Committing here never opens a pull request. That is a separate action, described in the next section.

## Open a pull or merge request

When the session's remote is on GitHub or GitLab, **Environment** has a **Create PR** or **Create MR** row. Choose it, check the branches, title and description, then choose **Create PR** or **Create draft PR** (**MR** on GitLab). Once the request exists, the row reads **View PR** or **View MR** and opens the request inspector, where you can see checks and reviews and merge.

OpenWaggle creates requests through the `gh` or `glab` command-line tool, signed in to the remote's host. If the row says something is missing, such as the CLI or a sign-in, it offers the fix. [Pull and merge requests](/docs/developer-workflow/pull-requests) covers creating, inspecting and merging requests, where they open, and how OpenWaggle recognizes GitHub and GitLab hosts and accounts.

## Follow project actions and setup

**Actions** lists the project actions running or recently run in this session's workspace. Select a row to see its output and controls in the right sidebar. Starting an action that is already running opens its current run instead of starting a second copy, so use **Restart** when you want a fresh one. These runs are separate from the tabs in your [built-in terminal](/docs/developer-workflow/built-in-terminal).

**Workspace preparation** shows the setup for the session's workspace: its progress, the output it kept, and any change waiting for your review. A new managed worktree must finish its configured setup before the agent's first turn. If setup fails, read **Setup output**, then choose **Retry setup** or **Continue anyway**. **Stop setup** stops an attempt that is still running. A session in your existing checkout runs setup only when you choose **Run setup**. When the project's setup has changed since the worktree was made, the section offers the newer version. See [setting up new worktrees](/docs/configuration/project-actions#set-up-new-worktrees).

## Check scheduled tasks

**Scheduled** lists the Heartbeats that send their prompt into this session, with their schedule. Hover a row to see its next run. Right-click it for **Run now**, **Pause**, **Edit** and **Delete**. The **+** at the top of the section adds a Heartbeat for this session. A session started by a Launch schedule shows **Started by** and the task's name instead.

A Heartbeat whose last wake check found no work shows **Nothing to do**. See [Scheduled tasks](/docs/using-openwaggle/scheduled-tasks).

## Follow a Hive

For a Queen or a worker, the **Hive** row counts the session's direct workers by who acts next. It shows how many **need you**, how many are **waiting for** this session, how many are **working**, and how many are **closed** (accepted or cancelled), for example `3 direct Workers · 1 needs you · 2 waiting for Queen`. These are the groups the [Hive panel](/docs/using-openwaggle/hives-and-sessions#who-acts-next) uses. Only **need you** is shown in the attention colour.

A worker waiting for this session may have a result to review, a failed run, or a question. That is for this session's agent to handle, not you. In a Hive with more than 50 direct workers, a count followed by `+` covers only the workers loaded so far.

A worker's row also names the session that started it. Click anywhere on the row, or focus it and press `Enter` or `Space`, to open the Hive panel. The panel lists every session in the Hive at every depth, so its header can count more workers than this row. A Hive made by the older MCP task feature cannot be listed there, so its row shows only the counts.

## Extension sections

[OpenWaggle extensions](/docs/extending/openwaggle-extensions) can add their own sections to the Summary, and their own sources and outputs. Their sections sit after the pull request section, after **Hive**, or at the end. If one extension's section fails, it shows an error and the rest of the Summary keeps working.

## Sources and outputs

A source is something the session used: a file you attached, a project file you referenced with `@`, a link you sent, a page or file a tool read, or a web search. An output is something the session recorded as a result: a file, an image, a site, a commit, or a pull request.

OpenWaggle records them as the conversation happens. Not everything counts:

- A URL that appears in ordinary text is not a source.
- A file the agent changed is not an output unless the session recorded it as one. **Environment > Changes** shows every change in the checkout, recorded or not.

The Summary shows up to six outputs and three sources, with the total beside each section's title. Click an image to open it in the image viewer. Click anything else to open the resource browser with that item selected, or click **Show all** to see everything.

### Add a source

Use the **+** at the top of **Sources** to give the session something to work from.

![The Add a source menu open at the top of Sources, with Attach files and Reference project file](/screenshots/session-summary-add-source.png)

- **Attach files** opens the file picker and adds the files to your message draft, as the message box's **+** menu does.
- **Reference project file** puts `@` in the message box so you can pick a file from the project.

The files become sources when you send the message.

## Browse everything in the resource browser

**Show all** under **Sources** or **Outputs** opens the resource browser, titled **Sources & outputs**, in the right panel. You can also open it with **Resources** on the panel rail. It takes the Summary's place while it is open. Closing it brings the Summary back if it was open before.

![The Sources & outputs browser with the Sources filter selected and items grouped under Images, Files, Links & sites, Tools and Web searches](/screenshots/session-resources-browser.png)

The **Sources** and **Outputs** buttons at the top switch between the two lists. Each list groups items by type:

- **Sources**: **Images**, **Files**, **Links & sites**, **Tools**, **Web searches**, **Commits** and **Change requests**.
- **Outputs**: **Images**, **Files**, **Sites**, **Commits**, **Change requests**, **Links**, **Tools** and **Web searches**.

Each row says who provided, read, created or updated the item, such as **Provided by you** or **Read by the agent**, with the conversation branch and the time. If an item appeared more than once, for example at several paths, the row uses the occurrence on the branch you are viewing, or the latest one if none is on that branch.

The browser loads 40 items at a time. **Show more** loads the next page, and its count is the number of items not yet loaded. If the list changes while you browse, it starts again from the first page so nothing is skipped or shown twice. Opening an item from the Summary or a link selects it without loading every earlier page.

What clicking an item does depends on its type:

- An image opens the image viewer.
- A local file opens in its usual desktop app. **Open original** and **Reveal original** use the file's recorded path, when it has one.
- A file that OpenWaggle keeps a copy of downloads that copy.
- Links and sites open in your web browser.
- An item whose saved content is missing says so, and offers **Retry** when OpenWaggle can try to recover it.

The list keeps updating while the session works in the background, without mixing in other sessions' items. When you stop an agent or Waggle run, results it had started saving finish saving before the run reports that it stopped, and they stay in the list. If you switch sessions while the browser is open, it clears the previous selection. If it ever shows the previous session's items after a switch, report it with the two session titles and the steps you took.

## View images

Click an image in a message to page through that message's images. Open an image from the Summary or the resource browser to page through every image in the session: images on the branch you are viewing come first, including those from earlier shared history, then images that exist only on other branches.

In the viewer you can:

- go to the previous or next image with the buttons or `ArrowLeft` and `ArrowRight`, wrapping around at the ends;
- fit the image to the window, or zoom to 25, 50, 100, 150 or 200 percent with the zoom buttons, `Cmd` or `Ctrl` with the mouse wheel, or a trackpad pinch;
- drag to pan;
- copy the image, add it to your message draft, or download it, once it has loaded;
- open or reveal the original file when it is still on disk;
- see whether it is a source or an output, and on which branch;
- press `Escape` to close.

Adding an image to the draft makes it an attachment, with the same size limits as the file picker. If the image cannot load or decode, choose **Retry image**. The viewer closes when you switch sessions, and an action still in progress cannot add the image to another session's draft.

### Images in the agent's replies

When the agent's reply shows a local PNG, JPEG, GIF or WebP image through a `file:` link, OpenWaggle can copy it into the session's outputs. The file must be inside the session's working directory or a temporary evidence folder, such as `electron-qa-evidence` or `openwaggle-evidence` under the system temporary directory. OpenWaggle checks the file and keeps its own copy, so deleting the temporary original later does not remove the image. Images at other local paths are not copied. Older messages can still pick up their images while the originals exist; otherwise the item stays unavailable and you can retry it.

OpenWaggle does not download a remote image just because a message or a resource list mentions it. Opening it in the viewer downloads it over HTTPS, with checks on redirects, size, content type and local network addresses, and saves a copy for the session. If the download fails, the viewer shows an error. It does not open the address in your browser instead.

## Archive or delete a session

Every item belongs to one session, including items from that session's other branches. A Queen and its workers each have their own list. Archiving a session keeps its items. Deleting a session for good removes its list and the files OpenWaggle saved for it.

OpenWaggle will not delete a Queen that still has direct workers, even completed or archived ones; delete the workers first. Stop an active worker before deleting it. When something blocks a deletion, OpenWaggle leaves the session as it is and tells you what to do.

Removing a project checks the whole Hive first, then deletes from the workers up to their Queen. Active work, a missing worker, or a broken parent link stops the removal before anything is deleted. If the session list changed while the confirmation was open, check it and confirm again. If a deletion fails partway, OpenWaggle stops deleting and refreshes the sidebar, and the project stays in it.

Older sessions fill in their lists in batches in the background. You can use the Summary and the resource browser while that happens.

## If something is missing

- No Summary at all: send the session's first message, or close the right sidebar and click **Open Session Summary**. Running a project action also needs a session that already exists.
- No pull request row, or a disabled one: the remote must be on GitHub or GitLab, with `gh` or `glab` signed in to that host. **Settings > Connections > Source control** shows which provider OpenWaggle chose for the host and why. On a detached `HEAD`, create or check out a branch first. A new branch needs at least one commit, or local changes selected under **Commit and push local changes**, before you can open a request.
- A pull request exists but is missing from **Outputs**: use **Retry adding PR to Outputs** in the creation panel when it offers it.
- A changed file is missing from **Outputs**: check **Environment > Changes**. Only files the session recorded appear as outputs.
- A link is missing from **Sources**: a URL in ordinary text is not recorded.
- A section shows an error: use its **Retry**. For an image, use **Retry image** in the viewer.
