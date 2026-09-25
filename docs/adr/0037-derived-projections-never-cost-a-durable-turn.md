# Derived Projections Never Cost a Durable Turn

Status: proposed

## Context

Real-Electron QA (September 2026) reproduced a completed run that was never saved. The reply streamed in full and Pi reported `agent_end` with reason `stop`. Then the Session Host's `persistSessionSnapshot` failed, and a second `agent_end` with reason `error` reached the renderer for the same run. The user saw "Something went wrong", and the turn was gone after a reload.

The failing statement was the incremental transcript-term projection: `CHECK constraint failed: token_count >= 0` on `session_transcript_term_documents`. The session's stored token count had drifted below the contribution of nodes the snapshot changed or removed. The term index is derived data. It exists for discovery ranking, and the transcript is readable without it.

The installed alpha shows the same signature on September 22 (`code: unknown`, `error: ""`). Its cause could not be confirmed, for two reasons:

- `SessionProjectionRepositoryError` is a tagged error with an empty `message`, so every log line and error card carried no detail.
- Since the Session Host became a detached process (ADR 0030), only the GUI process initializes file logging. The Host's console goes to `/dev/null`, so later occurrences left no trace at all.

Drift validation (`validateTranscriptTermCounts`) runs only during the one-time Host cutover. A per-Session exact rebuild (`refreshSessionTranscriptTerms`) exists but is called only by tests.

## Decision

**A turn's durable persistence never depends on a derived projection succeeding.**

- The incremental term projection inside `persistSessionSnapshot` runs in a savepoint. If it fails, the savepoint is rolled back, and the Session's term index is rebuilt exactly with `refreshSessionTranscriptTerms` in the same transaction. The turn then commits.
- If the rebuild also fails, the turn still commits. The failure is logged with its full cause, and the Session is queued for a background rebuild. Discovery results for that Session may be stale until the rebuild lands.
- A failure to persist the turn itself is reported as "This response couldn't be saved", with the failed operation and cause chain in its details. It is never reported as the generic unknown error.

**The detached Session Host writes its own log file** (`openwaggle-host-YYYY-MM-DD.log`) in the application logs directory, beside the GUI log. "Open Logs" opens that directory.

**Error formatting preserves tagged errors.** Logs and error details include the error tag, repository operation, and cause chain. An empty `message` never produces an empty log field.

## Consequences

Search and discovery ranking can briefly disagree with the transcript after a projection failure, and they are repaired without user action. The upstream cause of drift remains unknown. The new Host log records the Session and operation the next time it happens, which makes it diagnosable rather than silent.
