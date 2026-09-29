# Session agents reach every project, and each Session gets a private scratch directory

Status: accepted

Date: 2026-09-29

Supersedes in part: [ADR 0013](0013-adopt-first-party-mcp-integration.md), its Session Control rule that internal desktop agents discover same-workspace sessions by default and need a separate grant to read or message across projects. [ADR 0030](0030-adopt-single-local-session-host.md) is refined: its `current` launch Workspace now has a defined meaning when the target project is not the caller's.

Two concurrent gosafe Sessions both ran `git push ... > /tmp/push.log 2>&1`. Their pre-push hook output interleaved, and one Session concluded it had pushed a branch it never touched. The same Sessions kept Terraform state holding a database connection string under fixed `/tmp` names. Every tool process shared one temp directory and nothing told the model so.

The same gosafe Session then tried to hand the bug to an agent in the OpenWaggle repository. `list` with the other `projectPath`, `launch`, and `create` all returned `An error has occurred`, and `catalogScope: all` showed only gosafe Sessions. The Host had pinned a root Session agent's target scope to its own project, and the refusal was an Effect tagged error without a message, which Effect renders as that placeholder. A human had to copy the report between windows.

## Decision

### Cross-project reach

- **A root Session agent whose authority comes from the local desktop user reaches every project.** Its Sessions tool scope is the whole local catalog. Capabilities and the Authorization ceiling still decide what it may do, exactly as they did inside one project. The project was never a security boundary against a same-user shell (ADR 0030), and it blocked the one thing the maintainer requires: agents in different repositories talking to each other without a human courier.
- **Narrower authority stays narrow.** A root born from a named CLI profile keeps that profile's scope; only a catalog-wide profile (`all`) reaches every project. Workers keep their exact derived scope and never gain project-wide or catalog-wide reach from this rule.
- **The same rule applies when a queued Follow-up is delivered.** Delivery re-checks the source's live authority, so a catalog-wide root's cross-project Follow-up is delivered rather than paused as `authority_changed`.
- **Every existing action works across projects**, including discovery, read, report, Follow-up, launch, and create. Nothing new is granted: respond, approve, and authorization changes remain excluded from root agents by default.
- **A cross-project launch or create resolves its Workspace in the target project.** `local` and `new-worktree` work as usual. An omitted Workspace falls back to the target project's local checkout, because the caller's current Workspace does not exist there. An explicit `current` is refused and the message names `local` and `new-worktree`.
- **A refusal states its reason.** Authorization refusals name the code and what is missing, for example `Session command refused (capability_denied): ... Missing capabilities: sessions:create.` Other message-less Host failures report their tag, operation, and cause chain, redacted and bounded. The CLI's error frames use the same text.
- **The tool schema names per-action required fields.** The provider schema must stay a flat object (issue #218), so a field such as `objective` is described as `Required for launch, spawn.` instead of being marked required at the root.

### Session scratch directory

- **Each Session gets its own scratch directory**, `<os temp>/openwaggle-scratch-<uid>/<sessionId>`, created owner-only (0700). The Host refuses a symlink, a non-directory, or a directory another user owns. Workers get their own directory rather than sharing the Queen's.
- **Tool processes receive it as `TMPDIR`, `TMP`, and `TEMP`.** It is applied after any captured Workspace preparation environment, so a setup script cannot point tools back at the shared temp directory.
- **The Host-written system prompt names the absolute path** next to the visualization directory line and tells the model not to write fixed names under `/tmp`. The environment variables alone would not have prevented the incident, because the model typed a literal `/tmp/push.log`.
- **Archiving or deleting a Session removes the directory.** Unarchiving and running again recreates it; a removal still in flight completes first.
- **Failure to create it does not block the turn.** The Host logs a warning and the tools keep the Host temp directory, which is the old behaviour.

## Consequences

An agent in one repository can list, search, read, report to, send Follow-ups to, launch, and create Sessions in another repository without sharing a Hive. Users who want a project boundary for an external agent use a named CLI profile scoped to that project. OpenWaggle does not warn about fixed `/tmp` paths in shell commands; the prompt instruction and `TMPDIR` cover the observed failure, and a heuristic command scanner is left for later if models keep ignoring it.
