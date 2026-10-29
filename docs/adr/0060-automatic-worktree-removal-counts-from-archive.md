---
status: accepted
---

# Automatic worktree removal counts from the archive date

Date: 2026-10-29

Amends: [ADR 0010](0010-adopt-worktree-per-session-environment-mode.md), its **Death** bullet ("removed on session archive/delete").

Settings > Worktrees listed one project's worktrees with every path, branch and removal option spelled out, and it could not remove the worktree of an archived Session at all: archiving keeps the Session's Workspace binding, and removal was admitted only for a worktree with no binding. Worktrees piled up under `~/.openwaggle/worktrees` with nothing showing how many there were or what they held. The decision, made with the maintainer, is a page that covers every managed worktree across projects, removes an archived Session's worktree on request, and offers **Automatic worktree removal** as an opt-in rule.

## Decisions

- **Archiving never removes a worktree by itself.** ADR 0010 said a worktree is removed on archive; the code already kept it (`pruneSessionWorktree` with `reason: 'archive'`), and that stands. `git worktree remove` refuses modified and untracked files but deletes ignored ones (`.env`, `node_modules`, build caches), and archiving is reversible.
- **Automatic worktree removal is off by default and app-wide.** When on, it removes a managed worktree once every Session bound to it has been archived for 7, 14, 30, 60 or 90 days (30 when first turned on). The Session's Archive time already exists (`sessions.archived_at`), so this needs no new tracking; "last used" was rejected because the app does not record it reliably across Runs, terminals and Actions.
- **It never removes a worktree that holds work only it has.** A worktree with uncommitted changes, commits on no remote, a failed Workspace cleanup, a lock, a removal blocker or a state Git could not report is kept, and the page lists it with the reason. The branch is always kept. The setting says plainly that ignored files are deleted.
- **A worktree no Session is bound to is removed only by hand**, since it has no archive date to count from; folder timestamps change with any build.
- **Removing an archived Session's worktree keeps the binding.** Removal is admitted when every bound Session is archived and has no active Run; the Workspace stays `ready` with its folder gone, so an unarchived Session meets the existing missing-worktree choice in the composer (Recreate it from its branch, or switch to the current checkout). A Run cannot start in a worktree while its removal is in progress.
- **Archive & remove** archives every Session that works in a worktree and then removes it, in one confirmed action that names each Session. The other blockers (an active Run, an open terminal, a running Action) still apply. It never discards uncommitted changes: it may override only Git's lock, and a worktree with changes is kept, its Sessions archived, for an explicit Discard & remove.
- **Disk space is Reclaimable space**: blocks of files that are not hard-linked from elsewhere, measured in the Session Host in the background and cached for an hour. It is labelled "about" because copy-on-write clones (APFS) cannot be told apart cheaply.
- **Each automatic run is recorded** in the Host and shown on the page; a run that removed something shows one toast the next time the app opens.

## Consequences

- The page reads through new Host UI channels (`worktrees:*`), which ship with Local Session revision 30.
- Deleting an archived Session whose worktree was already removed no longer refuses on the missing worktree.
