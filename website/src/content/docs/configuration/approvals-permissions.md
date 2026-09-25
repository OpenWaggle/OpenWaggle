---
title: "Approvals and permissions"
description: "Choose agent access, review protected actions, and revoke saved approvals."
order: 2
section: "Customize"
---

Start with **Ask for Approval** while you learn how the agent works. This asks you to review protected actions. It is not a read-only mode, an operating-system sandbox, or a prompt before every file edit.

## Choose an access mode

1. Open **Settings > Permissions**.
2. Set **Default access mode** to **Ask for Approval**.
3. Use the project picker if a repository needs a different setting.
4. Under **Selected project**, choose its mode or **Use default** to remove a project override.
5. Check the agent-access control beside the message box before sending work. A session may have its own choice rather than inherit the default.

OpenWaggle also offers **YOLO (Full Access)**. It automatically allows actions that use the app's authorization checks, without asking you each time. The shipped default is YOLO, so change it explicitly if you want approval prompts. Separate tool restrictions and ordinary questions can still apply.

The project picker here only selects which project's permissions you are inspecting. It does not move your active conversation to that project.

## Respond to an approval request

Read the action, requester, and target before approving. For a command, consider its effects rather than only its name. For an external tool, check which service or account it will reach.

- **Allow once** permits this request without saving a broader approval.
- **Continue without** declines the request so the agent can continue without that action. Explain an alternative in the conversation if needed.
- When scope choices are available, **Allow for this session** allows matching requests in that session. The **Always allow…** choice names the requester, target, and project it will cover.

Use a saved approval only when you understand what later requests it covers. Approving a request does not prove its output is safe or that the requested change is correct.

## Revoke saved approvals

1. Open **Settings > Permissions** and select the project.
2. Find the entry under **Saved approvals**.
3. Click **Revoke** and check that it disappears without an error.

Revocation stops future use of that approval. It does not undo edits, retract data already sent, or recall completed commands. If approvals fail to load, do not assume the empty view means none exist; use **Retry loading approvals**.

## Project actions and automatic preparation

Saving a [Project Action](/docs/configuration/project-actions) does not grant the agent permission to run it. Agent requests to start, restart, or stop managed actions use the existing authorization checks. Listing definitions, reading output, and reopening an already-running action do not launch another process.

Workspace setup and cleanup have a separate local review decision. Saving your own private preparation command enables that version on your machine. Finding a shared definition in `.openwaggle/actions.json` does not enable it, even in YOLO mode.

Use **Review changes** to inspect the command and working directory, then choose **Enable this version** or **Keep disabled**. Changed execution definitions require review again; closing the dialog does not approve them. Review covers the definition, not every script it calls, so inspect repository changes too.

Failed setup pauses the first agent turn in a new worktree. **Continue anyway** bypasses that preparation requirement; it does not mean setup succeeded. Failed cleanup retains the worktree. **Delete anyway** skips cleanup and may leave resources such as temporary databases behind.

## What these settings do not protect

An instruction such as "don't edit files" is guidance to the model, not an enforced permission boundary. Review changes in the diff, work on a development branch or separate worktree, and keep backups appropriate to the task.

Your terminal is still an ordinary shell. Commands and tools can access data available to their process, including environment credentials. MCP servers have additional trust and capability settings, and agent browser access has a separate switch in **Settings > Browser**.

See [Security and privacy](/docs/configuration/security-privacy) for data handling and [MCP](/docs/configuration/mcp) for external-tool access.
