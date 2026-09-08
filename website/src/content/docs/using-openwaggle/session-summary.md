---
title: "Session Summary & Resources"
description: "Use the floating Session Summary, browse session Sources and Outputs, and inspect shared images."
order: 2
section: "Using OpenWaggle"
---

The Session Summary keeps the opened session's working context and durable resources close to the transcript. It appears in the top-right after the first message has been sent. Before then, the composer setup row owns the project, environment, and run-target choices.

The Summary is always a floating overlay. It never narrows the transcript or moves the composer. OpenWaggle hides it automatically when the chat area is too narrow or a right sidebar is open. Use the **Session Summary** layout-list button in the header to hide it or explicitly reopen it over the chat at any window size.

Resizing between wide and narrow layouts keeps your unsent text, selected command chips, and interactive visualization state intact.

At narrow widths, an explicit reopen is temporary. Press `Escape` or click outside the Summary to dismiss it without changing the saved wide-layout preference. A right sidebar always takes precedence. The header button remains visible but disabled until the sidebar closes. At wider widths, OpenWaggle remembers whether the Summary is open and which sections are expanded for each session.

Authorization mode and context usage stay in the composer. They are not duplicated in the Summary.

## What the Summary shows

Sections appear only when their session has relevant data:

- **Environment** shows working-tree changes, the bound local checkout or worktree, the Git branch, **Commit or push**, and the GitHub pull-request or GitLab merge-request action.
- **Pull requests** or **Merge requests** appears when this session created additional requests. When the current branch already has one, the section is labelled **Other pull requests** or **Other merge requests** and does not duplicate it.
- **Hive** shows the opened session's immediate parent and direct Workers, grouped as Active, Done, and Archived. It never mixes in another Hive or a Worker's children.
- **Outputs** shows the exact count and a bounded, internally scrolling preview of files, images, sites, commits, change requests, and other explicit results created or updated during the session.
- **Sources** is always available with its add action, even before the session has a Source. Its plus menu can attach files through the native composer picker or insert an `@` project-file reference. The request is bound to the opened session, so a session switch cannot deliver it to another draft. The section previews attachments, links, tools, web searches, and other explicit inputs used by the session. Choose **Show all** for the complete catalog.
- **Subscriptions** appears for active MCP event subscriptions owned by this session. A failed refresh stays inside the section and can be retried there.
- Extensions can add named, declarative sections for session-scoped information or actions. A failing extension section is isolated from the rest of the Summary.

OpenWaggle does not turn ordinary URL-like prose into a Source, and it does not treat every modified working-tree file as an Output. Working-tree changes belong under Environment until the agent or a producing tool explicitly identifies a result.

## Environment and Git actions

Choose **Changes** to open the Diff sidebar. The environment row identifies the checkout that this session already uses; it cannot be changed after the first message because doing so would move an existing conversation to a different working tree.

The branch row opens a searchable picker. You can check out an existing branch, create one from an unmatched search, or copy the branch name. Branch mutations use the same guarded Git path as the rest of OpenWaggle.

**Commit or push** opens one command panel for committing on the current branch or a validated new branch. It reports staged and unstaged totals separately, and **Include unstaged changes** controls whether OpenWaggle stages working-tree content or commits only the existing index. The available **Commit**, **Commit & push**, and **Push** actions adapt to the repository and remote state; unavailable actions explain what is missing. `Cmd+Enter` on macOS or `Ctrl+Enter` on Windows and Linux runs the first available action. Pull-request and merge-request creation remains a separate, explicit action.

Enter the commit message before a commit-bearing action. OpenWaggle does not have a commit-message generation service yet, so the field starts blank and never claims that an empty value will be generated.

The panel can stop a multi-step action between Git steps. It does not interrupt a commit or network push that is already running; **Stop after current step** waits for that step to finish and prevents the next one from starting.

The Environment plus menu can open the working folder, copy its path, or toggle the built-in terminal.

## Creating a pull or merge request

For a GitHub remote, choose **Create PR**. For GitLab, choose **Create MR**. The composer shows:

- source and target refs;
- an editable new-branch name when one is required;
- title and description fields;
- **Commit and push local changes** when the working tree is dirty;
- draft and ready-for-review creation actions;
- **Open PR/MR in browser** as a fallback;
- `Cmd+Enter` on macOS or `Ctrl+Enter` on Windows and Linux for the primary action.

Native creation checks the command-line client for the exact remote host before it creates a branch, commits, or pushes. GitHub requires an installed, authenticated `gh`; GitLab requires an installed, authenticated `glab`. When native creation is unavailable, the composer explains why, disables the native draft and ready actions, and keeps the browser workflow available when the remote can provide one.

When the session is still on the default branch, the composer proposes a validated feature branch. The session title supplies the initial request title. Leaving the description empty creates a short Summary and, when local changes will be committed, includes the changed-file totals. The browser fallback carries the current branch, target, title, and description to the provider page. It does not commit, push, or create the request inside OpenWaggle.

After a request is created, the Summary replaces the create row with **View PR** or **View MR**. This opens the request inside OpenWaggle's right sidebar; it does not launch a browser.

The request inspector is bound to the opened session's working tree and to an exact request in that repository. It supports switching between additional requests recorded as Outputs by that session, even when many unrelated Outputs exist, manual refresh, title and provider URL, base/head refs, open/draft/merged state, changed-file totals and a branch-diff entry, checks, review and mergeability state, and comment/review-thread counts when the provider CLI supplies them. The retained sidebar does not query while closed, and a request route from one session is discarded when another session opens.

**Open in browser** is a separate explicit action. When the provider says a request is safe to merge, choose merge, squash, or rebase in the inspector. OpenWaggle confirms in the main process, then rechecks the session, repository, request identity, merge state, and exact head commit before invoking `gh` or `glab`. A disabled merge action explains whether checks, reviews, conflicts, draft state, provider rules, or missing metadata block it.

Request creation and session recording are separate guarded steps. If the provider creates the request but OpenWaggle cannot add it to Outputs, the composer keeps the provider URL and, when it retained safe retry authority, offers **Retry adding PR/MR to Outputs**. That retry records the existing request. It never creates a duplicate.

OpenWaggle does not yet expose Codex's request-repair or add-to-chat shortcuts because there is no existing safe task/composer API that can attach provider feedback without inventing a second message path.

## Following a Hive

The Hive section appears only for a Queen or Worker. A Queen sees direct Workers, while a Worker sees its immediate parent. Worker rows show states such as Working, Waiting, Needs attention, Ready for review, Revision requested, Accepted, or Cancelled. Archived direct Workers remain available in their own group.

Hive opens automatically when a Worker needs attention, while work is active, or when the opened session is itself a Worker. For a Queen, an automatically opened section collapses shortly after all direct work finishes. A manual expansion choice wins and is remembered for that session. Selecting a row opens that session; keyboard focus returns to its Session Summary button after navigation.

## Browsing Sources and Outputs

Resources produced by a background session refresh that session's catalog even while you are viewing another session or Settings. Switching sessions never mixes their resources. Rapid switching also keeps resource loading bounded while earlier requests finish.

Stopping an agent or Waggle run lets it finish saving and indexing any partial outputs before reporting completion. Those persisted outputs remain available in the session's catalog.

The Resource Browser shares the right sidebar with Diff, Session Tree, and other inspectors. It has separate **Sources** and **Outputs** views, groups related resource kinds, and shows provenance such as who provided, read, created, or updated an item and on which session branch it occurred.

Large catalogs load in stable, bounded pages while retaining an exact total. **Show more** requests the next page; opening an exact resource link does not load all earlier rows. If the catalog changes between pages, OpenWaggle restarts at the first page so an item cannot be silently skipped or duplicated.

Selecting a non-image Summary item opens its owning Resource Browser view with that item selected. **Show all** opens the complete Sources or Outputs catalog without expanding the Summary preview. Opening the browser hides the floating Summary; closing the browser restores the Summary when that session's saved state says it should be open.

The browser always rebinds to the currently opened session as one operation. Selection from the previous session is cleared before the new session's resources render, so content cannot flash or leak between sessions.

When the same resource was shared from different paths or URLs, its row shows the occurrence on the visible transcript path. **Open original** and **Reveal original** use that occurrence's locator; if it is not on the visible path, the latest matching occurrence is used.

Choose a non-image local file to open it with its normal desktop handler, or use the row actions to open or reveal the original path. Links and sites open in the system browser. A managed non-image file downloads a copy. If OpenWaggle knows about a resource but its managed content is missing, the row shows that state and offers **Retry** when recovery is possible.

## Viewing images

Images shared by either the user or the agent open in one session gallery from the transcript, Summary, or Resource Browser. The gallery contains only the opened session's images, with every image on the active transcript path—including shared ancestors—before images exclusive to other branches. A deep link opens immediately with its true position and correct previous/next images, without loading every earlier page.

The viewer supports:

- previous and next buttons plus `ArrowLeft` and `ArrowRight`;
- fit-to-window and 25, 50, 100, 150, or 200 percent zoom;
- dedicated zoom-out, fit, and zoom-in buttons;
- `Cmd`/`Ctrl` + mouse wheel or Chromium-supported trackpad pinch zoom;
- centered zoom and drag-to-pan;
- `Escape` to close;
- copy the decoded image through the system clipboard;
- add the image to the current composer through the same size-limited, registered attachment pipeline as the file picker;
- download;
- open or reveal for a resolvable local original;
- Source/Output and branch provenance;
- retry when managed content cannot be read.

When OpenWaggle validates image bytes, it stores them in session-owned managed storage. Full image bytes do not cross the renderer IPC boundary as base64. Thumbnails are bounded and loaded on demand. Chat Markdown does not mount remote image URLs in Chromium, so merely viewing a message cannot trigger a direct or local-network request. A remote Markdown image is cataloged without fetching it; opening the viewer is the explicit action that authorizes a bounded HTTPS fetch with redirect, size, content, and local-network checks. The validated copy is then cached for that session.

Adding a gallery image to the composer reads it through that managed-store boundary and creates a private registered attachment copy. A stored resource path is never handed to the renderer as reusable file authority.

Copy, add-to-chat, and download become available after the current image loads. If the image becomes unavailable or cannot be decoded, use **Retry image** to request a fresh copy. A failed remote fetch remains visible as an error and does not silently open the remote URL. Switching sessions while an action is running cancels its result for the old viewer or draft.

The viewer closes when you change sessions. Its short-lived image and download links are revoked at the same transition, even if the next session never opens the Summary or Resource Browser.

OpenWaggle does not display nonfunctional Codex-only image actions. Edit, Canvas, Share, and app-connector actions remain absent until OpenWaggle has a secure native capability for each one.

## Session ownership and persistence

Each resource belongs to exactly one session, including resources produced on alternate transcript branches. Parent sessions and Workers keep separate catalogs. Archiving retains the catalog; permanently deleting the session also removes its catalog and managed files.

A Queen session cannot be permanently deleted while it still has direct Workers, including completed or archived Workers. Delete those Workers first. Removing an entire project handles this automatically by deleting each Hive from its leaves toward its Queen. This keeps surviving Worker sessions from losing their visible parent relationship.

Recoverable resources from older sessions are backfilled lazily in bounded batches. The Summary and Resource Browser remain usable while that work completes.

Extension authors can publish session Sources and Outputs or add Summary sections through the brokered extension SDK. See [OpenWaggle Extensions](/docs/extending/openwaggle-extensions).

## If a Summary action is missing

- Send the session's first message before looking for the Summary. OpenWaggle does not show an empty shell for a draft session.
- Close the right sidebar or use the header's **Session Summary** button to reopen the overlay. At narrow widths, an explicit reopen floats over the transcript instead of resizing it.
- A pull-request or merge-request action appears only when OpenWaggle can identify a supported GitHub or GitLab remote. The composer reports missing or unauthenticated `gh` or `glab` access for that remote's exact host.
- Create or check out a branch if the repository is on a detached `HEAD`. A new feature branch also needs at least one commit, or local changes selected for **Commit and push local changes**, before a request can be created.
- If the request exists on GitHub or GitLab but is missing from Outputs, keep the composer open and use its record-only retry when offered. If you close the composer before recording succeeds, the request remains valid at the provider but may stay absent from this session's Outputs.
- Sources and Outputs are based on explicit evidence. A URL mentioned as ordinary prose and an otherwise unclassified modified file intentionally stay out of the catalog.
- If a catalog or subscription load fails, use the local **Retry** action. If managed image content is unavailable, use the viewer's retry action. Remote images are not fetched merely because a transcript, Summary, or thumbnail is visible.

When switching sessions, OpenWaggle closes the image viewer and atomically rebinds an open Resource Browser before showing data. If content from the previous session ever remains visible, treat that as a privacy bug and report it with the two session titles and the navigation sequence that reproduced it.
