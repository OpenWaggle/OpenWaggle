# Per-Turn Worktree Checkpointing

Status: accepted

OpenWaggle will add a per-turn checkpointing subsystem so the diff panel can show a **Turn diff**: the file changes produced by one Pi agent turn. This is a new persistence concern with real storage-growth trade-offs, so it is recorded here.

## Context

T3Code backs its per-turn diffs with a checkpointing subsystem: per-turn worktree snapshots stored as diff blobs in SQLite (migration `003_CheckpointDiffBlobs`, `checkpointing/Diffs.ts`, `CheckpointDiffQuery.ts`), queried by turn range.

OpenWaggle has no equivalent:

- The "Pi session snapshot" (`projectPiSessionSnapshot`) is a projection of conversation/message state, not filesystem state.
- `FileConflictTracker` records edited paths per agent/turn in memory only (a `Map`, cleared on `reset()`), with no file content and no persistence.

Deriving Turn diffs from git history alone was considered and rejected: it only works for committed flows and cannot represent uncommitted in-turn edits. Faithful checkpointing was chosen so Turn diffs are well-defined even for uncommitted edits.

## Decision

Add a main-process **Turn checkpoint** subsystem, distinct from Pi conversation snapshots and from `FileConflictTracker`:

- Capture a snapshot of the **Session worktree** file state per Pi agent turn (ADR 0010 provides the worktree; in `local` mode the opened checkout is the working directory).
- Persist each snapshot as a diff blob in SQLite, modeled on T3Code migration `003_CheckpointDiffBlobs`.
- Provide a query interface that computes a **Turn diff** over a turn range, modeled on `CheckpointDiffQuery`.
- Reuse a unified-diff summary parser (ported from T3Code `parseTurnDiffFilesFromUnifiedDiff`) to derive per-file additions/deletions.

Storage growth is a first-class concern: the subsystem must define a retention/pruning policy (for example, prune checkpoints when a session is archived/deleted, and bound per-session checkpoint counts) rather than growing unbounded.

## Consequences

- A new SQLite migration and read/write path for checkpoint diff blobs.
- The agent-run lifecycle must trigger a checkpoint capture at turn boundaries; this hooks into the Pi run projection in `src/main/adapters/pi/` but the checkpoint store itself is OpenWaggle-owned and Pi-free at its boundary.
- The diff panel gains a `turn` diff scope (ADR-independent renderer store) that reads Turn diffs by turn id/range.
- Disk usage grows with turn count; retention/pruning must be implemented and covered by tests.

## Non-goals

- Not a general-purpose backup or time-travel/rewind of the working tree.
- Does not replace Pi session (conversation) snapshots.
- No cross-session or cross-repo checkpoint sharing.
