---
title: "Session Summary & Resources"
description: "Use the floating Session Summary, browse session Sources and Outputs, and inspect shared images."
order: 2
section: "Using OpenWaggle"
---

The Session Summary keeps the opened session's working context and durable resources close to the transcript. It appears in the top-right after the first message has been sent. Before then, the composer setup row owns the project, environment, and run-target choices.

The Summary is always a floating overlay. It never narrows the transcript or moves the composer. OpenWaggle hides it automatically when the chat area is too narrow or a right sidebar is open. Use the **Session Summary** layout-list button in the header to hide it or explicitly reopen it over the chat at any window size. Open and collapsed choices are remembered per session.

Authorization mode and context usage stay in the composer. They are not duplicated in the Summary.

## What The Summary Shows

Sections appear only when their session has relevant data:

- **Environment** shows working-tree changes, the bound local checkout or worktree, the Git branch, **Commit or push**, and the GitHub pull-request or GitLab merge-request action.
- **Hive** shows the opened session's immediate parent and direct Workers, grouped as Active, Done, and Archived. It never mixes in another Hive or a Worker's children.
- **Outputs** lists files, images, sites, commits, change requests, and other explicit results created or updated during the session. The list scrolls inside the Summary when it grows.
- **Sources** previews attachments, links, tools, web searches, and other explicit inputs used by the session. Choose **Show all** for the complete catalog.
- **Subscriptions** appears for active event subscriptions owned by this session.
- Extensions can add named, declarative sections for session-scoped information or actions. A failing extension section is isolated from the rest of the Summary.

OpenWaggle does not turn ordinary URL-like prose into a Source, and it does not treat every modified working-tree file as an Output. Working-tree changes belong under Environment until the agent or a producing tool explicitly identifies a result.

## Environment And Git Actions

Choose **Changes** to open the Diff sidebar. The environment row identifies the checkout that this session already uses; it cannot be changed after the first message because doing so would move an existing conversation to a different working tree.

The branch row opens a searchable picker. You can check out an existing branch, create one from an unmatched search, or copy the branch name. Branch mutations use the same guarded Git path as the rest of OpenWaggle.

**Commit or push** adapts to the repository state while remaining separate from review-request creation. It can commit local changes, commit and push, or push committed work. Pull-request and merge-request creation is always a separate, explicit action.

The Environment plus menu can open the working folder, copy its path, or toggle the built-in terminal.

## Creating A Pull Or Merge Request

For a GitHub remote, choose **Create PR**. For GitLab, choose **Create MR**. The composer shows:

- source and target refs;
- an editable new-branch name when one is required;
- title and description fields;
- **Commit and push local changes** when the working tree is dirty;
- draft and ready-for-review creation actions;
- **Open PR/MR in browser** as a fallback;
- `Cmd+Enter` on macOS or `Ctrl+Enter` on Windows and Linux for the primary action.

Native creation checks the command-line client for the exact remote host. GitHub requires an installed, authenticated `gh`; GitLab requires an installed, authenticated `glab`. When native creation is unavailable, the composer explains why and keeps the browser workflow available when the remote can provide one.

After a request is created, the Summary replaces the create row with an action that opens that request.

## Browsing Sources And Outputs

The Resource Browser shares the right sidebar with Diff, Session Tree, and other inspectors. It has separate **Sources** and **Outputs** views, groups related resource kinds, and shows provenance such as who provided, read, created, or updated an item and on which session branch it occurred.

Selecting a non-image Summary item opens its owning Resource Browser view with that item selected. **Show all** opens the complete Sources catalog. Opening the browser hides the floating Summary; closing the browser restores the Summary when that session's saved state says it should be open.

The browser always rebinds to the currently opened session as one operation. Selection from the previous session is cleared before the new session's resources render, so content cannot flash or leak between sessions.

## Viewing Images

Images shared by either the user or the agent open in one session gallery from the transcript, Summary, or Resource Browser. The gallery contains only the opened session's images, with the active transcript branch first and other session branches after it.

The viewer supports:

- previous and next buttons plus `ArrowLeft` and `ArrowRight`;
- fit-to-window and 25, 50, 100, 150, or 200 percent zoom;
- centered zoom and drag-to-pan;
- `Escape` to close;
- download;
- open or reveal for a resolvable local original;
- Source/Output and branch provenance;
- retry when managed content cannot be read.

OpenWaggle stores validated image bytes in session-owned managed storage instead of carrying base64 payloads through the renderer. Thumbnails are bounded and loaded on demand. A remote Markdown image is cataloged without fetching it; opening the viewer is the explicit action that authorizes a bounded HTTPS fetch with redirect, size, content, and local-network checks. The validated copy is then cached for that session.

The viewer closes when you change sessions.

## Session Ownership And Persistence

Each resource belongs to exactly one session, including resources produced on alternate transcript branches. Parent sessions and Workers keep separate catalogs. Archiving retains the catalog; permanently deleting the session also removes its catalog and managed files.

Recoverable resources from older sessions are backfilled lazily in bounded batches. The Summary and Resource Browser remain usable while that work completes.

Extension authors can publish session Sources and Outputs or add Summary sections through the brokered extension SDK. See [OpenWaggle Extensions](/docs/extending/openwaggle-extensions).
