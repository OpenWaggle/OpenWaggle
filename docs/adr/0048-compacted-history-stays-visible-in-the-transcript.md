# Compacted history stays visible in the transcript

Status: accepted

Date: 2026-10-07

## Context

A compaction replaces older context with a checkpoint (ADR 0025): a Native provider item, or a Portable handoff plus a recent verbatim tail. Pi keeps every original entry in the Session file and builds the model's context from the latest compaction: the checkpoint first, then the entries it kept, then everything appended after it.

OpenWaggle built the transcript from that same model context. After a compaction the chat lost every message the compaction summarized, and the "Context compacted" marker sat above whatever was kept. A Native checkpoint keeps no entries, so the chat started at the marker. A user who ran `/compact` saw the live marker disappear when it finished and never found it again unless they scrolled to the top, past a conversation that had shrunk without warning. The user docs already said compaction "does not delete the saved conversation", and Codex keeps the history above its marker.

## Decision

The transcript is for the user, and the model's context is for the model. They are two different paths through the same Pi entries (`src/shared/utils/session-entry-paths.ts`):

- **Transcript path** (`buildPiTranscriptPath`): the selected branch from its root to its active entry, in Pi log order. Every compaction marker and branch summary appears where Pi appended it. The Session detail's `messages` and the workspace `transcriptPath` use it, as do the views built from them: chat rows, Session tree path highlighting, fork targets, and branch actions.
- **Model context**: built only by Pi from its own Session file (`buildSessionContext`). This covers runs, compaction preparation, Native reconstruction for an incompatible model, and the composer context meter (`getContextUsage`). OpenWaggle does not change it. `buildPiModelContextPath` mirrors the entry selection Pi makes for a compatible checkpoint, so a reader of the projection can tell which entries Pi keeps in context. Integration tests check it against Pi. It never decides what the transcript shows, and it never feeds the model.

Actions on a message above a marker go through Pi's tree as they do anywhere else. Branching from it, or editing and resending it, moves Pi's leaf to that entry. The new branch's context is that branch's own path, which does not include the later compaction, and Pi's pre-turn threshold check compacts it again if it no longer fits. Forking or cloning copies that path into a new Session. Copy works on the message text. None of them needs to be disabled.

Search, exports, and the Sessions tool's transcript reads already read the full `session_nodes` path and were unaffected.

## Considered Options

- **Show only the model's context (the previous behaviour).** It is faithful to what the model sees, but it silently removes conversation from the user's view, and the Native case removes all of it.
- **Show the full history and dim the entries outside the model's context.** This was deferred. It needs the projection to carry Pi's model-dependent selection, which Pi alone resolves for an incompatible Native checkpoint, and the marker already tells the reader where the model's context starts.

## Consequences

A long Session that compacted many times renders all of its rows again. The transcript keeps its bounded sliding window (ADR 0036, at most about 160 mounted rows), so mounted DOM stays bounded. Deriving rows remains linear in the branch length. On a synthetic Session of 6,000 nodes with 11 compactions, `getSessionDetail` took about 17 ms instead of 7 ms, `getSessionWorkspace` stayed at about 21 ms, and building every chat row took about 12 ms.

Agent-loop cards recorded before a compaction (interactions, notices, extension messages) come back with the history. They used to be appended below the newest answer, which the compacted view had hidden. Each card now sits where it happened: within the Run whose audit chain it belongs to, after the last message created before it (`agent-loop-card-placement.ts`). This applies to compacted and uncompacted Sessions alike.

The renderer's compaction lifecycle counts durable markers across the whole branch. The live row is acknowledged by the marker's entry id, so this is consistent. Transcript indexes no longer shrink when a compaction finishes.
