---
title: "Session tree and branches"
description: "Return to an earlier message, try another approach, or copy a conversation into a new session."
order: 6
section: "Using OpenWaggle"
kind: "guide"
---

Use the Session Tree when you want to go back to an earlier point in a conversation and try something else. The path you leave stays saved as a branch, so you can return to it later.

Conversation branches are not Git branches. Moving to another branch doesn't undo file edits or switch your repository's branch. Use the [Git controls](/docs/developer-workflow/git-integration) for files and commits.

![The Session Tree beside a Waggle conversation, with its latest reply marked as the active point on the main branch](/screenshots/session-tree-panel.png)

## Open the Session Tree

Click **Session Tree** on the [panel rail](/docs/using-openwaggle/right-panel), or press `Cmd+Shift+Y` on macOS or `Ctrl+Shift+Y` on Windows and Linux. You can also press `Cmd+K` or `Ctrl+K` and choose **Session Tree** under **Panels**.

The tree opens in the right panel, which shows one panel at a time, so it takes the place of Changes or whatever else was showing.

## Try a different approach

1. Find the earlier message you want to continue from.
2. Select its row. The conversation now shows the path up to that point.
3. If OpenWaggle asks, decide whether to bring a summary of the later work with you. See [Bring a summary of the later work](#bring-a-summary-of-the-later-work).
4. Check the draft in the message box, write or edit your next instruction, and send it.

For example, go back to the message before a proposed refactor and ask the agent to compare a smaller change. Check your files first: the changes the earlier approach made are still on disk.

Selecting an earlier point only prepares a draft branch; it doesn't save a new branch yet. Selecting one of your own messages can also put its text in the message box, ready to retry or edit. OpenWaggle saves the new branch when you send, or earlier if you choose a branch summary action that creates it. Selecting the latest point of a saved branch takes you back to that branch and drops any draft.

## Start from a message in the conversation

You can also start from the conversation itself. Hover a message to see its actions. A reply's actions sit at the end of its turn, under any changed files, and the latest reply always shows them.

| On | Action | What it does |
|----|--------|--------------|
| Your message | **Edit from here** | Goes back to just before the message in this session and puts its text in the message box. |
| Your message | **Fork from here** | Starts a new session from just before the message, with its text ready to edit and resend. |
| Your message | **Copy message** | Copies the message's text. |
| The reply that ends a turn | **Continue from here** | Goes back to just after that reply in this session, so your next message continues from it. |
| The reply that ends a turn | **Fork from this response** | Starts a new session with the conversation up to and including that reply, and an empty message box. |
| The reply that ends a turn | **Copy response** | Copies the reply's text. |

Tool calls and the agent's notes between them have no actions of their own; select them in the Session Tree instead. While the session is working or compacting, only **Copy message** and **Copy response** are shown.

## Copy a conversation into a new session

To copy history into a separate session from the keyboard, type `/fork` or `/clone` in the message box, or open the command palette and choose:

- **Fork to new session** to pick one of your earlier messages and start a new session with that message ready to edit and resend.
- **Clone current session** to copy the path you are on into a new session with an empty message box.

Both leave the original conversation as it was. The new session gets the original's name, marked `(fork)` when it starts before one of your messages and `(copy)` for a clone or a fork from a reply. You can rename it. A copy of a session still called New session stays New session and takes its name from its next message. Forks and clones copy the conversation, not your working files.

## Read the tree

Each row is a point in the saved conversation, such as a message or a tool event. Dots and lines show how the points connect.

- The active path is the conversation the chat shows.
- Branch badges mark the latest point of each saved branch.
- A draft marks an earlier point you selected but haven't continued from yet.
- Archived branches stay in the full tree even though the sidebar hides them.

The sidebar shows sessions and their saved branches, not every point in their history. A list tree icon with a count means a session has more than one branch.

## Filter and search the tree

Use the filter menu to show less detail:

| Filter | What it shows |
|--------|---------------|
| Default | Messages and tool results, without bookkeeping entries such as model changes. |
| No tools | The default view without tool results. |
| User only | Your messages. |
| Labeled | Label entries in the conversation history. |
| All | Every entry, including tool and structural detail. |

OpenWaggle remembers the filter in your Pi settings as `treeFilterMode`, and a project's Pi settings can set a different default. Search looks through the entries the filter shows, matching message text, details and branch names. Matches inside collapsed rows appear for the search without changing which rows you had expanded. If a filter hides the entry you need, choose **All**.

Use the arrow keys to move through the tree, `Enter` to select a row and `Escape` to close it. [Keyboard shortcuts](/docs/getting-started/keyboard-shortcuts) lists every key.

## Bring a summary of the later work

When you go back to an earlier message, the later messages are no longer on your path. OpenWaggle asks whether to bring some of that work along:

- **No summary** continues without a summary of the later work.
- **Summarize** asks the model to summarize that work.
- **Custom** lets you write instructions for the summary in the message box, then press Send.
- **Cancel** goes back to where you were.

This changes what the agent knows, not the files on disk. [Context management](/docs/using-openwaggle/context-management#branch-summaries) explains how a branch summary differs from compaction. To skip the question, set Pi's `branchSummary.skipPrompt`.

A link to a session can keep the branch, the selected point and the open Session Tree (`branch`, `node` and `panel=session-tree` in the address). A draft branch you haven't sent is not saved, so a copied link doesn't bring it back.

## Rename, archive and restore branches

Rename a saved branch inline in the sidebar. Archive a branch other than the main one to hide it from the sidebar, and restore it from Settings when you need it. Archived branches stay visible in the full tree. You can't delete a single conversation branch.

Archiving the main branch archives the whole session. OpenWaggle doesn't ask first, because you can undo it from **Settings > Archived items**. If you archive the session you have open, OpenWaggle opens the next session in the same part of the sidebar, or the empty home screen when none is left. A session that gets archived somewhere else while you have it open, for example by Hive cleanup, stays on screen with a notice and a **Restore** button.
