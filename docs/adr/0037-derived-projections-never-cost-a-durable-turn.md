# Derived Projections Never Cost a Durable Turn

Status: accepted

## Context

Real-Electron QA (September 2026) reproduced a completed run that was never saved. The reply streamed in full and Pi reported `agent_end` with reason `stop`. Then the Session Host's `persistSessionSnapshot` failed, and a second `agent_end` with reason `error` reached the renderer for the same run. The user saw "Something went wrong", and the turn was gone after a reload.

The failing statement was the incremental transcript-term projection: `CHECK constraint failed: token_count >= 0` on `session_transcript_term_documents`. The session's stored token count had drifted below the contribution of nodes the snapshot changed or removed. The term index is derived data. It exists for discovery ranking, and the transcript is readable without it.

The installed alpha shows the same signature on September 22 (`code: unknown`, `error: ""`). Its cause could not be confirmed, for two reasons:

- `SessionProjectionRepositoryError` is a tagged error with an empty `message`, so every log line and error card carried no detail.
- Since the Session Host became a detached process (ADR 0030), only the GUI process initializes file logging. The Host's console goes to `/dev/null`, so later occurrences left no trace at all.

Drift validation (`validateTranscriptTermCounts`) runs only during the one-time Host cutover. A per-Session exact rebuild (`refreshSessionTranscriptTerms`) exists but is called only by tests.

## Decision

**A turn's durable persistence never depends on, or waits for, a derived projection.**

- The incremental term projection inside a snapshot runs in savepoints and checks the document count against its inverted index. On any failure only the projection savepoint rolls back, and the Session's term index is marked stale by removing its rows. Removal is bounded by the Session's vocabulary; an exact rebuild would tokenize every node inside the turn's transaction.
- "Nodes but no term document" is the durable stale marker. It survives restarts, covers every snapshot path including fork, and disappears with the Session.
- A Host background service (`runTranscriptTermRepairBackground`) rebuilds stale Sessions outside any turn. It works in a bounded batch per pass, one transaction per Session, with per-Session exponential backoff, and is woken early when a snapshot marks a Session stale. Discovery results for that Session are missing until the repair lands.
- Run failures are classified from the original error. Only a failed snapshot write (`persistSessionSnapshot`) after the agent answered is reported as "This response couldn't be saved"; a later projection write, such as the turn-checkpoint anchor, fails after the turn is already durable. The classic and Waggle paths share this classification.
- Detail published beyond the Host log (renderer, CLI, feedback reports) is redacted, abbreviates the home directory, and is bounded. The full cause stays in the Host log.

**The detached Session Host writes its own log file** (`openwaggle-host-YYYY-MM-DD.log`) in the application logs directory, beside the GUI log. It awaits the file before startup work so early diagnostics are kept. "Open Logs" opens that directory, and feedback reports include the Host log.

**Error formatting preserves tagged errors.** Logs and error details include the error tag, repository operation, and cause chain. An empty `message` never produces an empty log field.

## Consequences

Search and discovery can briefly miss a Session after a projection failure; it is repaired without user action. The repair checks aggregate consistency, not term-level content, so corruption that preserves the totals is not detected; that needs a projection revision tied to canonical content and is left to follow-up work. The upstream cause of drift remains unknown. The new Host log records the Session and operation the next time it happens, which makes it diagnosable rather than silent.
