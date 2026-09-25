---
title: "Projects and worktrees"
description: "Choose whether the agent works in your current checkout or a separate Git worktree."
order: 8
section: "Using OpenWaggle"
---

A project is a folder you open in OpenWaggle. A session is a conversation about work in that project. Before its first message, choose which working directory the session will use.

## Work in your current checkout

Choose **Current checkout** above the message box to use the folder you opened. The agent reads and changes the same files you see in your editor and terminal.

Use this for a small task on your existing development branch. Review or save unrelated work first. Before the session's first agent run, OpenWaggle attempts a fast-forward-only pull from that branch's upstream. This can update your checkout. If the pull fails, the task still starts with the available local state. Later turns do not repeat the pull.

Two sessions using the same checkout share its files and Git branch; separate chats do not keep their edits apart.

## Give a session its own worktree

A Git worktree is another checkout of the same repository in a separate directory. It shares the repository's history but has its own files and checked-out branch. Use one when you want an agent to work separately from your current checkout.

1. Open a new session under your project.
2. Choose **New worktree** above the message box.
3. Use the adjacent branch picker to select a base branch. Uncommitted changes are not copied into the new checkout.
4. If the project has several preparation profiles, choose one for this worktree.
5. Send your first message. OpenWaggle creates the worktree and its session branch before starting the agent.

When the selected base is a local branch, OpenWaggle first tries to fetch it from `origin`. It uses the remote-tracking tip when your local branch is equal to or behind it. By default, a local branch that is ahead or has diverged keeps its own tip. If fetching fails, creation uses the available refs rather than requiring a network connection.

The conversation shows **Creating a worktree** while Git creates the checkout. If creation fails, open **More details** and choose **Retry** after resolving the problem. **Cancel** returns the submitted message to your draft. **Work locally** instead retries the task in your current checkout, where the agent can change your existing files.

Configured **Workspace setup** is separate from Git checkout creation. It must finish successfully before the first agent turn in a new managed worktree. If it fails or needs review, open **Session Summary > Workspace preparation**. Review the command, choose **Retry setup**, or deliberately **Continue anyway**. Existing checkouts run this setup only when you choose **Run setup**. See [Workspace preparation](/docs/developer-workflow/built-in-terminal#workspace-preparation).

A worktree separates working files. It is not a security sandbox and does not restrict what commands can access on your machine.

## Check where work is happening

After the first message, open **Session Summary** in the header and check **Environment**. The diff panel, Git actions, and newly opened terminals use that session's working directory.

A terminal you opened before creating the worktree remains in the original checkout. It is labeled **Original checkout**. Open a new terminal for the worktree, or choose **Restart in worktree** to stop and relaunch the inherited shell there.

The initial checkout/worktree choice is fixed after the session starts. To begin elsewhere, create another session. Missing worktrees have an explicit recovery flow rather than silently moving your work.

## Manage worktrees

Open **Settings > Worktrees** to list and remove session worktrees. Review and preserve any work you need before removal. They are stored outside your project under `~/.openwaggle/worktrees/`.

Configured cleanup runs before actual removal, after the final session releases the workspace and managed action processes stop. If cleanup fails, OpenWaggle keeps the checkout and offers **Retry cleanup** or **Delete anyway**. Deleting anyway can leave resources such as temporary databases behind.

For branch naming, setup feedback, missing-worktree recovery, and the full Git controls, see [Git integration](/docs/developer-workflow/git-integration#choosing-where-a-session-runs).
