# Turn Settle-Fold Presentation

Status: accepted

## Context

The transcript currently keeps every artifact of a turn visible forever: one tool-call block per call, interim assistant commentary, a `RunSummary` phase table ("Completed in 47s" plus per-phase durations), and an `InterruptedRunNotice` card after a stop. A 30-call turn pushes its own answer out of the viewport and drowns the result in process. Per-message `useMessageCollapse` already hides tool parts behind a "Show details" divider once a message settles, but there is no turn-level presentation, no duration, and no per-turn file summary in the transcript — the Turn diff from per-turn checkpoints (ADR 0011) surfaces only as a hover button.

Two reference implementations converge on the same answer. T3 Code folds every entry of a settled turn behind one quiet "Worked for Xs" row, keeps only the terminal assistant message, and renders a changed-files card under it backed by per-turn diffs. Codex emits a dim "Worked for Xm Ys" separator — but only for turns that did concrete work — and pushes an aggregated per-turn diff to its GUI. OpenWaggle already owns the hard part: ADR 0011's Turn checkpoints compute per-turn diffs, and the Pierre renderer (ADR 0016) owns diff presentation.

## Decision

**The transcript presents activity while working and results once settled.** A new **Turn fold** collapses a settled turn's work-class content — tool blocks, thinking, interim assistant messages, the phase table — behind a single quiet row: "Worked for Xs" when completed, "You stopped after Xs" when interrupted, anchored at the start of the turn. A chevron re-expands the full turn. Turns that produced no work get no fold row; the phase table and `InterruptedRunNotice` are deleted, replaced by the fold's settled and You-stopped states.

**Changed files card.** Every settled turn with a Turn diff renders a changed-files card under its terminal assistant message: "Changed files · N files · +ins/−del", one row per file with per-file +/−, auto-expanded for the most recently settled turn when it is small (≤5 files and ≤200 changed lines), collapsed otherwise with a compact preview (≤3 filenames or ≤4 directory scopes) on the latest turn. Expansion persists per session and turn (localStorage); the fold's expansion is per-session in-memory UI state retained for the app's lifetime rather than resetting on session switch, so returning to a session restores its folds. Card rows open the Turn diff view.

**One diff surface.** The transcript renders no diff fragments. The inline unified-diff view inside tool-call blocks is deleted; edit tool rows carry the file label and +/− counts, and expanding one shows arguments and output as plain text. File diffs render only in the Turn diff view (the diff panel at Turn scope), reached from the changed-files card or the turn's file rows, optionally focused on one file.

**Fold attribution and contracts.** A Waggle invocation folds per agent turn, each fold carrying its agent colour, with the Turn divider pill remaining the turn header. Fold rows route through the existing extension `status` surface — settled (success) and interrupted (warn) — so Agent-loop contributions keep their hook; the live run keeps the phase-indicator row on the same surface, so there is no separate live fold row. Waggle per-agent-turn fold rows carry the agent colour in their row data; the section's colour rail already renders it. Durably recorded per-turn durations exist for the invocation's final agent turn (checkpoints are per run); earlier agent turns in the same invocation fall back to the live timer while it is fresh, then "Worked". Authorization history entries, pending interactions, errors, the Worktree launch trace, and compaction rows never fold.

**Turn duration is durable.** Turn checkpoints record the turn's start time alongside the existing end time, so "Worked for Xs" survives restarts; the live phase timer covers the just-settled turn before its checkpoint summary arrives.

## Consequences

Three surfaces disappear (`RunSummary`, `InterruptedRunNotice`, the tool-block inline diff) and per-message "Show details" collapse is absorbed by the fold, so the transcript has one expansion grammar instead of two competing ones. The transcript grows roughly one fold row plus the final answer per turn, and the Changed-file navigator gains a turn-scoped entry point. Live-turn tool grouping ("Edited 2 files · Ran 3 commands" mid-stream) is deferred: during the active turn tool blocks render inline as today, and grouping only pays off inside the expanded fold, which renders full detail. Session-branch forks and steered continuations fold independently because fold identity is derived from message segments, not run ids.

The fold hides process detail by default, which is the point — but it means a settled transcript no longer shows *how* the result was produced without one click. That trade is the decision.
