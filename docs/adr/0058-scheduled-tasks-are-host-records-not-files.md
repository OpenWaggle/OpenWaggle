---
status: accepted
---

# Scheduled tasks are Host records, not files

Agent definitions, Project actions and MCP servers are files, but Scheduled tasks live only in the Session Host's SQLite database, private to the user. A Scheduled task starts recurring, unattended, token-spending work, and every Scheduled task run revalidates the authority of the caller that created it. A file has no creator: if writing `~/.openwaggle/…` or `.openwaggle/…` could create a task, any agent with filesystem write access could schedule work while bypassing Session Control capabilities and CLI client profile revocation. Keeping definitions, run history and next fire times in one database also lets one transaction change them together. v1 has no shared project Scheduled tasks; the GUI, the Hive CLI (with JSON export and import) and the agent tool are the only ways to create, change or move them.

## Considered options

- **An editable file per task (Codex's `automation.toml` plus a SQLite cache).** Needs sync and migration code between the file and the cache, and makes a filesystem write enough to schedule work.
- **Shared project tasks in `.openwaggle/`.** Useful for teams, but each teammate would need to review and enable each definition, as with Workspace automation enablement, and to review it again when its prompt or target changes. Deferred until after v1.

## Consequences

- Scheduled tasks don't travel with a repository or a dotfiles checkout; moving them is an explicit export and import, and an import is created under the importing caller's authority.

## Amendment (2026-10-27): a Wake check is part of the record (#388)

A Heartbeat's Wake check command and the exact command the user approved are columns of its Host record, like its prompt: no file sets one, and an export carries the command but not its approval, so an import sets it again under the importing caller, which approves it only when that caller is the user.

## Amendment (2026-11-02): a task a Session agent created does not depend on its Session

Tasks a Session agent created used to run as that agent (`session-agent:<session>:<run>`), so every run resolved the agent's authority from its Session's rows. Deleting that Session made the check throw, and because the throw was a defect rather than a failure, it escaped every scheduler tick: no task fired at all until the Host restarted, and the failing task never showed as needing attention. The maintainer asks agents to set up tasks because it is easier than the editor, not to tie the task to that conversation. Decided with the maintainer on 2026-11-02:

- **A task runs as its owner.** A Session agent's task runs as the local user or CLI client profile its Session acts for (the task's owner), and `creator` keeps who created it, for display only. A revoked profile still stops its tasks; a deleted Session no longer does.
- **Within the agent's authority.** The task stores the agent's capabilities, scope and Authorization ceiling at creation (`authority_limits_json`, migration 86) and each run acts within them, through the caller's `authorityLimits`, which `refreshNamedProfileCaller` applies again at dispatch (for a profile owner, intersected with the live profile through the Session catalog). An agent holding its owner's whole authority (the local user's, every default capability, every project, YOLO) stores none, so its task runs exactly as one the user created. Worker grants are not carried over, and limits that cannot be read hold the task to nothing. A launched Session takes the limits as its own scope and ceiling. A Heartbeat's Run starts in an existing Session, whose agent takes its reach and ceiling from the owner and that Session, so a Heartbeat is refused, when created and at each run, where that would exceed the limits: a Session that reaches every project for an agent held to fewer, or a YOLO Session for an agent held to ask-for-approval. The task detail says when a task runs with limited access, and a refusal names the remedy.
- **Agent-created launches stay in known projects.** A Launch schedule a catalog-wide agent created may only target a project that already has a Session or Workspace (ADR 0042), checked when it is created and at each run, whoever it now runs as.
- **Changing what a task does decides whose it is.** When a task's owner (the local user, or the CLI client profile whose task it is) changes its prompt, target, stop condition or Wake check, it runs as them with their whole authority from then on; pausing, resuming or rescheduling it changes nothing. When a Session agent changes them, the task keeps only what both it and the agent may do, intersected through the Session catalog, and a Heartbeat edit is refused when the result would cross the boundary above. An adoption write that loses to a concurrent edit re-reads the task before it runs.
- **Older tasks are adopted.** A task still naming its agent is rewritten on its next check: with the agent's limits when its Session still exists, or as its owner's when the Session is gone.
- **One task cannot stop the others.** Each task's share of a scheduler sweep handles its own failures and defects; a firing that failed waits a minute before trying again.

