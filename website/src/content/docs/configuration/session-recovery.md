---
title: "Troubleshooting and recovery"
description: "Resolve connection problems, waiting sessions, and missing worktrees before considering database recovery."
order: 1
section: "Help"
---

Start with the problem you can see. Read the error or pending request before retrying. Database restoration is not a fix for an unavailable model, a waiting approval, or a deleted worktree.

## A provider or model is unavailable

1. Open **Settings > Connections** and check the provider you selected beside the message box.
2. For an API key provider, expand **API Key Providers** and inspect its status. Use the pencil icon to enter and **Test** a key, then **Save** it. Testing does not save the key.
3. For browser sign-in, expand **OAuth Providers** and check for **Connected**. Finish any pending sign-in instructions or use **Try again** after an error.
4. Under **Available Models**, enable the model you want. The message-box selector requires both enablement and availability through the provider's current credentials.
5. Select the model under the provider you connected and try a small request.

**Configured outside OpenWaggle** means credentials were found through environment variables, cloud credentials, or custom provider configuration. You do not need to paste another key just to change this status. For a project-specific provider, check that the intended project is selected.

If the provider is connected but the request fails, read the error for account access, billing, quota, rate limits, or network problems. A successful login does not grant access to every model. See [Providers and models](/docs/providers/overview), [API key authentication](/docs/providers/api-key-auth), or [Browser sign-in](/docs/providers/oauth-auth).

## A session is waiting instead of answering

Open the session and look above the message box for **Waiting for you** or an approval request. The agent may need an answer, a selection, or permission before it can continue.

Read the request and respond there. For a protected action, **Allow once** permits it, while **Continue without** declines it. Do not switch to full access just to dismiss a request you have not understood. See [Approvals and permissions](/docs/configuration/approvals-permissions).

If your message is in the follow-up queue, it may be waiting for the current work to finish. A paused queue shows **Resume**; inspect any item needing attention before resuming delivery. Repeatedly sending the same task can queue duplicate work. See [Conversations and tools](/docs/using-openwaggle/chat-and-tools).

## A worktree is missing or could not be created

If an existing session's worktree was deleted, OpenWaggle blocks new messages and offers two explicit choices:

- **Recreate worktree** reattaches the session's branch in a new worktree. It preserves commits on that branch but cannot restore uncommitted files deleted with the old folder.
- **Use current checkout** moves the session to the project folder you opened. Further agent edits affect that checkout, so check its branch and uncommitted work first.

For a new session whose worktree creation failed, open **More details** on the **Worktree setup failed** card. Correct the reported Git problem and choose **Retry**. **Cancel** returns the submitted message to your draft. **Work locally** retries it in the current checkout instead.

These actions change where the session runs; database restoration does not recover deleted working files. See [Missing-worktree recovery](/docs/developer-workflow/git-integration#recovering-a-missing-worktree).

## Work continues after closing the app

Closing or restarting the desktop window does not cancel active agent work. OpenWaggle's background session service keeps it running. Reopen the app and select the session to check its progress.

To stop active work, use the square **Cancel** button beside the message box and wait for cancellation to finish. Inspect the last tool results and file changes before asking the agent to continue. Cancelling cannot undo completed edits or retract a request already sent to an external service.

Quitting the desktop window and stopping the background service are different actions. Database recovery commands below need exclusive access, so they refuse to proceed while another process owns the database. Do not remove ownership files or force database access to get around that refusal.

## Collect details before asking for help

Copy the error message and note the selected provider, model, project, and working directory. Review logs for secrets and private code before sharing them. [App settings](/docs/configuration/app-settings#logs) lists log locations. For an external tool connection, use [MCP troubleshooting](/docs/configuration/mcp#when-something-fails).

## Recover an older session database

The remaining commands apply only to the recovery copy kept when an upgrade migrated the older `openwaggle.db` database. They are not a general undo command for an agent mistake, a failed request, or changed project files.

Start by inspecting recovery status. Do not restore an old database just because a model request failed. Restoration replaces the active conversation history with the older copy, so sessions and changes to session records made after migration will not appear in the restored history.

## Inspect recovery state

Run this in your terminal:

```sh
openwaggle recovery status --json
```

The result shows the active database and recovery-copy paths, sizes, timestamps, and whether the active schema is compatible. Inspecting status does not start another database owner. A fresh installation may have no pre-upgrade recovery copy.

Save the result and back up important work before deciding to restore. The database recovery copy is not a backup of your Git checkout or worktrees.

## Restore explicitly

1. Let active agent work finish and quit every OpenWaggle window.
2. Make sure the background session service has stopped. Closing a window alone may not stop active work.
3. Confirm that you accept losing newer session history from the active view, then run:

```sh
openwaggle recovery restore-pre-cutover --yes --json
```

The command requires exclusive database ownership. If it reports an ownership conflict, stop the remaining OpenWaggle work or clients before retrying. Do not delete lock or ownership files to force access.

Before replacement, OpenWaggle preserves the current active database as a timestamped artifact. It then migrates the recovery copy again. If restoration fails, it puts the current active database back.

Sessions and changes created after the original migration are not present in the restored history. OpenWaggle never performs this restoration automatically after a crash, failed agent request, or validation error.

## Remove the recovery copy

Only remove the copy after checking that your migrated history is correct and you no longer need it. Stop the background session service first, then run:

```sh
openwaggle recovery delete-pre-cutover --yes --json
```

This permanently deletes the recovery copy. The command reports the exact path and size removed. It is not a cleanup step required for normal app use.

## What the upgrade preserves

The one-time migration builds a new database beside the original, preserves session and transcript identities, rebuilds working-directory associations and text search, and validates the result before switching to it. A failed or cancelled migration leaves the old database untouched and will not open a partial replacement.

After success, normal launches use `session-host/session-host.sqlite`. The retained copy is `session-host/pre-cutover-openwaggle.sqlite`, beneath the app's application-data directory. Normal operation does not read or write that recovery copy, and a migration record prevents the upgrade from repeating.

Search by meaning needs an additional background index. It can report `preparing` or `failed` while text search remains available. Hybrid search falls back to text search until enough of that index is ready. Restarting resumes the remaining indexing work instead of repeating the database migration.

## Command errors

With `--json`, failures write this shape to standard error:

```json
{"schemaVersion":1,"error":{"message":"..."}}
```

This includes invalid options, missing `--yes`, ownership conflicts, and filesystem or migration errors. Usage errors exit with code `2`; other failures exit with code `1`. Read the message before retrying, especially when it names a database or recovery path.
