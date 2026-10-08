---
title: "Session Summary and resources"
description: "Check a session's working directory, review changes, and find files and images shared during the conversation."
order: 7
section: "Using OpenWaggle"
---

Session Summary brings together the current session's working directory, Git actions, shared files, and results. Use it to find something from the conversation without scrolling back through every message.

1. Open a session where you have sent at least one message.
2. Click **Open Session Summary** in the header. If a right sidebar is open, close it first.
3. Choose **Changes** to review file edits, or **Show all** under **Sources** or **Outputs** to browse resources.

The Summary floats over the conversation rather than narrowing it. It may open automatically when there is enough room. Use the header button to hide it again. Sessions in a [Hive](/docs/using-openwaggle/hives-and-sessions), or with workspace action or preparation activity, can show it before their first message.

## What the Summary shows

| Section | Use it to |
|---------|-----------|
| Environment | Check the working directory and Git branch, open changes, commit or push, and open a pull or merge request. |
| Sources | Find attachments, project references, links, searches, and other recorded inputs the agent used. Use the plus menu to attach a file or add an `@` project-file reference. |
| Outputs | Find files, images, sites, commits, and review requests explicitly recorded as results of the session. |
| Actions | Inspect running and recent managed project commands, including development servers. |
| Workspace preparation | Review setup progress and output, retry a failed setup, or adopt a newer preparation profile. |
| Hive | Open the parent or direct Worker sessions and check their progress. |
| Pull requests or Merge requests | Open additional requests created by this session. The label starts with Other when the current branch's request is already shown under Environment. |
| Subscriptions | Check this session's active MCP event subscriptions and retry a failed refresh. |

Sections appear when relevant, except Sources, which keeps its add action available even when empty. Extensions can add sections of their own. An error in one extension section does not prevent the others from working.

A URL mentioned in ordinary prose is not automatically a Source. A modified file is not automatically an Output either. All working-tree changes are available under **Environment > Changes**, including changes the session did not record as a result.

Agent access and context usage remain beside the message box, not in the Summary.

## Project actions and preparation

Running and recent project actions appear in **Actions**. Select a row to inspect output and controls
in the right sidebar. Starting the same action normally opens its existing active run rather than
launching another copy. Use **Restart** deliberately when you want to replace it. These managed runs
are separate from interactive terminal tabs.

**Workspace preparation** shows setup progress, retained output, review decisions, and recovery
controls. Configured setup must succeed before the first agent turn in a new managed worktree.
If it fails, inspect **Setup output**, then choose **Retry setup** or deliberately **Continue anyway**.
**Stop setup** stops an active attempt. Existing local checkouts run setup only when you choose
**Run setup**. See [Project actions](/docs/developer-workflow/built-in-terminal#project-actions).

## Environment and Git actions

Check the environment row before running Git commands. It identifies the current checkout or worktree used by this session. The original environment choice is fixed after the first message.

- Choose **Changes** to open the diff panel.
- Click the branch row to search and check out a branch, create one from an unmatched search, or copy its name.
- Use the Environment plus menu to open the working folder, copy its path, or toggle the terminal.
- Choose **Commit or push** to open the commit and push panel.

In **Commit or push**, check the staged and unstaged totals, the target branch, and **Include unstaged changes**. With that option off, a commit uses only the existing Git index. With it on, OpenWaggle also stages working-tree content. You can use the current branch or enter a validated new branch.

Enter a commit message before choosing **Commit** or **Commit & push**. OpenWaggle does not generate one for this panel. **Push** is also available when the repository state allows it. Disabled actions explain what is missing. `Cmd+Enter` on macOS or `Ctrl+Enter` on Windows and Linux runs the first available action.

**Stop after current step** prevents the next step of a multi-step action. It does not cancel a commit or network push already in progress. Creating a pull or merge request is a separate action.

For the full diff and commit controls, see [Git integration](/docs/developer-workflow/git-integration).

## Creating a pull or merge request

1. Choose **Create PR** for GitHub or **Create MR** for GitLab.
2. Check the source and target branches. If you are on the default branch, review the proposed feature-branch name.
3. Edit the title and description. The title starts with the session title.
4. If local changes need to be included, review **Commit and push local changes**.
5. Choose the draft or ready-for-review action. `Cmd+Enter` or `Ctrl+Enter` runs the primary action.

Creation inside OpenWaggle needs an installed and authenticated provider CLI: `gh` for GitHub or `glab` for GitLab. OpenWaggle checks access to the remote's exact host before creating a branch, committing, or pushing. When access is unavailable, it explains why and disables those actions.

**Open PR/MR in browser** is a separate fallback where the remote supports it. It carries the branch, target, title, and description to the provider's page. It does not commit, push, or create the request inside OpenWaggle.

Leaving the description blank creates a short Summary and includes changed-file totals if local changes will be committed. After successful creation, **View PR** or **View MR** replaces the create action and opens the request in OpenWaggle's right sidebar.

### Inspect and merge a request

The request inspector shows the title, provider link, base and head refs, open/draft/merged state, changed-file totals, and a branch-diff link. It also shows checks, reviews, mergeability, and comment counts when the provider CLI supplies them. Refresh manually when you need an update, or switch to another request recorded by the same session.

Choose **Open on GitHub** or **Open on GitLab** to use the provider's site. When the provider reports that merging is available, the inspector offers merge, squash, or rebase. OpenWaggle asks for confirmation and checks the request and exact head commit again before invoking the provider CLI. Disabled actions explain blockers such as checks, reviews, conflicts, draft status, provider rules, or missing information. The inspector names the GitHub account that read the request, for example **via @jdoe_acme**.

### Choose where a request opens

By default, **View PR** or **View MR** opens the inspector. The icon at the end of the row opens the request on the provider's site instead, and so does Cmd-click (Ctrl-click on Windows and Linux).

To open requests on the provider's site by default, go to **Settings > Connections > Source control** and set **Open pull and merge requests in** to **Provider website**. The row then swaps the two: a click opens the site, and the icon or a modifier click opens the inspector. The site opens wherever **Open web links in** sends web links.

A project can override the choice for itself. Your own choice in Settings wins over a project's shared setting. The agent can change either one for you; see [Source control hosts and accounts](#source-control-hosts-and-accounts).

### When a request cannot load

The row and the inspector say what is missing and offer one fix:

- **CLI not installed**: shows the install command for `gh` or `glab`. OpenWaggle checks again when the window regains focus.
- **Not signed in**: **Sign in to** *host* runs `gh auth login --hostname` *host* (or the `glab` equivalent) in a new terminal tab of the session, with the token variables cleared in that terminal tab, since the CLI refuses to sign in while they are set. The CLI handles single sign-on in your browser. OpenWaggle uses the CLI's stored sign-in and ignores `GH_TOKEN`, `GITHUB_TOKEN`, and `GITLAB_TOKEN`.
- **No account can see the repository**: names the accounts it tried. **Sign in with another account** adds an account to the CLI.
- **Unknown host**: asks once whether the host is GitHub, GitLab, or neither. Choose **Neither** for another forge, and OpenWaggle stops asking.

The provider's site stays one click away in every case.

## Source control hosts and accounts

OpenWaggle works with github.com, gitlab.com, GitHub Enterprise Server, and self-hosted GitLab. It decides which provider a remote belongs to without setup in most cases. It checks, in order:

1. Your own choice for the host.
2. A choice the project declares, once you approve it.
3. github.com, gitlab.com, and GitHub Enterprise Cloud hosts (`*.ghe.com`).
4. Hosts you are signed in to with `gh` or `glab`.
5. A `gh` or `glab` git credential helper for the host, or a repository path deeper than *owner/repository*, which only GitLab allows.
6. A host name that contains `github` or `gitlab`.
7. The change-request refs the remote itself advertises (`refs/pull/*` or `refs/merge-requests/*`). The answer is remembered for the host.

If none of these answers, the Session Summary asks once. Bitbucket, Azure DevOps, Codeberg, and gitea.com remotes, and Azure DevOps or Bitbucket Server repository paths, are recognised as other forges and never asked about, unless a stronger signal above says otherwise. A self-hosted Gitea or Forgejo server advertises the same refs as GitHub, so it may be detected as GitHub; set it to **Neither** in Settings. SSH host aliases from `~/.ssh/config` are resolved to their real host first, and `glab`'s `ssh_host` setting maps an SSH host back to its GitLab instance. OpenWaggle never contacts an unconfirmed server's API to identify it.

**Settings > Connections > Source control** lists every host OpenWaggle knows, including hosts from approved project declarations, how its provider was decided, and the accounts the CLI holds. You can change a host's provider, mark it as neither, add a host before cloning from it, or forget a provider you chose or OpenWaggle detected.

### Several accounts on one host

If `gh` holds more than one account for a host, for example a personal account and a GitHub Enterprise Cloud account on github.com, OpenWaggle tries the account it remembered for the repository first, then the active account. When that account cannot see the repository, it tries the others with each account's own stored token, for that command only. When an account other than the active one works, it is remembered for the repository. Creating, merging, and checking out a request never switch accounts: they run once, as the account that last read the repository, and the merge confirmation names it. OpenWaggle never runs `gh auth switch`, so your terminal's active account does not change.

### Forks

When your branch lives on a fork, OpenWaggle also looks for its request in the repository the fork came from and in a remote named `upstream`. The repository it finds is remembered.

### Project-level setup

A project can declare its hosts in `.openwaggle/settings.json`:

```json
{
  "sourceControl": {
    "hosts": { "git.acme.io": "gitlab" },
    "changeRequestOpenDestination": "website"
  }
}
```

The first time a project declares hosts, the Session Summary asks you to approve them. Declarations change nothing until you do. Each host is judged on its own: a host you approved stays approved when the project declares another one, and only a new or changed host asks again. Accounts are never stored in project files.

None of these choices belong to a single session. They are stored for the repository's main checkout, so they apply to every session of the project, including new worktrees. A host the agent declares from a worktree session applies to the whole project at once; a shared open destination written in a worktree takes effect once that change reaches the main checkout.

You can also ask the agent, for example "our GitLab is git.acme.io and open merge requests on the website". The agent's `source_control` tool reads the current setup and changes it after you approve the change. Signing in is always your step.

If the provider creates the request but OpenWaggle cannot record it under Outputs, keep the creation panel open. Use **Retry adding PR/MR to Outputs** when offered. That retries recording the existing request, not creating another one. Closing the panel leaves the provider request valid, but it may remain absent from this session's Outputs.

## Following a Hive

A Hive is a group of related sessions working on one task. The parent, called the Queen, can delegate work to Worker sessions. The Summary shows only the opened session's immediate parent and direct Workers, not every descendant.

Workers are grouped as **Active**, **Review**, **Done**, and **Archived**. **Ready for review** means the Worker submitted a result that its parent has not accepted or sent back for revision. This does not mean its Run has stopped. Open the Worker session to check whether it is still running. Accepted or cancelled work appears under Done. Finished Workers you never interacted with are archived automatically and move to **Archived**. Use the restore button beside an archived Worker to return it to the sidebar.

Select a row to open that session. The section opens automatically while work is active, needs attention, or awaits review. For a Queen, it collapses shortly after all direct work is accepted or cancelled unless you have chosen to keep it expanded. Your manual choice is remembered.

Large Hives have **Load more workers**. Counts still cover the whole direct Hive, and a failed page can be retried without losing rows already shown. Live updates refresh the list; a reconnect may restart it at the first page.

See [Hives and sessions](/docs/using-openwaggle/hives-and-sessions) for delegating and reviewing work.

## Browsing Sources and Outputs

Select **Show all** under Sources or Outputs to open the Resource Browser on the right. It groups resources by kind and shows who provided, read, created, or updated each item, along with its conversation branch.

Selecting a non-image item in the Summary opens the browser with that item selected. Selecting an image opens the image viewer. The browser replaces the floating Summary; closing it restores the Summary when it was previously open.

Use **Show more** for the next page of a large catalog. The total counts all items, not just the loaded page. If the catalog changes while you browse, it restarts from the first page to avoid skipped or duplicated items. A direct resource link opens its item without loading every earlier page.

File and link actions depend on the resource:

- A local non-image file can open in its normal desktop app.
- **Open original** and **Reveal original** use the recorded file path when available.
- A managed non-image file downloads a copy.
- Links and sites open in the system browser.
- Missing saved content shows its unavailable state and offers **Retry** when recovery is possible.

If a resource appeared at several paths or URLs, its row uses the occurrence on the visible conversation path, or the latest matching occurrence if none is on that path.

Resources from background sessions keep updating without mixing into the session you are viewing. Stopping an agent or Waggle run allows partial results to finish saving before completion is reported. Those saved results remain available.

## Viewing images

Click an image in chat to browse that message's images. Open an image from the Summary or Resource Browser to browse all images in the session. The session gallery lists images on the active conversation path first, including shared history, then images exclusive to other branches.

The viewer supports:

- previous and next buttons, or `ArrowLeft` and `ArrowRight`, with wraparound;
- fit-to-window and 25, 50, 100, 150, or 200 percent zoom;
- zoom buttons, `Cmd`/`Ctrl` + mouse wheel, and supported trackpad pinch zoom;
- drag-to-pan;
- copying the image, adding it to the current message draft, or downloading it;
- opening or revealing an available local original;
- Source/Output and branch details;
- `Escape` to close.

Copy, add-to-chat, and download become available after the image loads. Adding to chat creates an attachment with the same size limits as the file picker. Use **Retry image** if content is unavailable or cannot be decoded.

Local PNG, JPEG, GIF, and WebP images embedded in an agent's Markdown with `file:` URLs can be copied into the session's Outputs. The source must be inside the session's working directory or a supported temporary evidence folder, such as `electron-qa-evidence` or `openwaggle-evidence` under the system temporary directory. OpenWaggle validates the file and keeps its saved copy, so deleting the temporary original does not remove an image already captured. Other local paths are not automatically authorized. Older messages can recover these images while their originals are still available; otherwise the item remains unavailable and can be retried.

Remote Markdown images are not fetched merely because you read a message or see a catalog entry. Opening the viewer authorizes an HTTPS fetch with redirect, size, content, and local-network checks. OpenWaggle validates and saves a copy for that session. Failed fetches show an error rather than silently opening the URL in a browser.

The viewer closes when you switch sessions. Pending actions cannot add an image to a different session's draft, and temporary image and download links are revoked.

## Session ownership and persistence

Every resource belongs to one session, including resources from its alternate conversation branches. Parents and Workers have separate catalogs. Archiving retains resources; permanently deleting a session removes its catalog and managed files.

A Queen cannot be permanently deleted while it still has direct Workers, including completed or archived Workers. Delete the Workers first. An active Worker must be stopped before deletion. If either condition blocks deletion, OpenWaggle leaves the session intact and explains what to do.

Removing a project checks the whole Hive before deleting from Workers toward their Queen. Active work, a missing descendant, or an invalid parent relationship blocks removal without deleting siblings. If the session list changed while confirmation was open, review it and confirm again. A later deletion error stops further deletion and refreshes the sidebar while keeping project references available.

Older sessions can recover their resources in batches while the Summary and browser remain usable. Extension authors can add Sources, Outputs, and Summary sections through [OpenWaggle extensions](/docs/extending/openwaggle-extensions).

### Panel and tab behavior

At wide widths, OpenWaggle remembers whether the Summary is open and which sections you expanded for each session. At narrow widths, opening it is temporary. Press `Escape` or click outside to dismiss it without changing the saved wide-layout preference. Resizing does not clear your draft, command chips, or interactive visualizations.

A right sidebar takes precedence over the Summary. Its header button stays visible but is disabled until that sidebar closes. A floating browser preview also takes precedence over automatic Summary display. Explicitly opening the Summary hides that session's preview without closing the tab. Resource and other inspectors keep it hidden; closing an inspector restores the Summary if previously open, and hiding the Summary restores the preview.

Before the first message, Diff and file inspectors hide an unsent draft's floating preview. Closing the inspector restores the preview without creating an empty Summary.

Draft and existing-session terminal and browser tabs stay separate. Only sending the draft's first message moves its tabs into the new session. Tab creation and moves pause during that transfer. If browser tabs cannot move safely, they stay in the project draft and an error explains the failure. Use that project's **New session** action to return to them. Terminals already moved remain in the new session.

A browser tab stays visible if its page fails to close, so you can retry. Closing several tabs removes only those that closed successfully. Switching sessions during a close does not open a sidebar in the new session.

## If a Summary action is missing

- Send an ordinary session's first message. Existing Hive sessions and sessions with workspace activity can open the Summary earlier; an ordinary empty draft cannot. Running a Project action also requires an existing session.
- Close the right sidebar, then click **Open Session Summary** in the header.
- For pull and merge requests, check for a supported GitHub or GitLab remote and authenticated `gh` or `glab` access to that host. **Settings > Connections > Source control** shows which provider OpenWaggle chose for the host and why.
- Create or check out a branch if the repository is on a detached `HEAD`. A new feature branch also needs at least one commit, or local changes selected for **Commit and push local changes**, before request creation.
- If a request exists at the provider but is missing from Outputs, use the record-only retry in the creation panel when offered.
- Check **Environment > Changes** for modified files that were not explicitly recorded as Outputs. Ordinary URL text is not automatically a Source.
- Use the section's **Retry** for catalog or subscription failures, or **Retry image** in the viewer for missing image content.

An open Resource Browser clears its old selection when you switch sessions. If it ever shows the previous session's content after a switch, report it with the two session titles and the steps that reproduced it.
