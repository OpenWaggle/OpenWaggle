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
