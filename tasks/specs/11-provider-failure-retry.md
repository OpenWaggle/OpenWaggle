# 11 — Provider Failure Mid-Stream Retry

**Status:** Planned
**Priority:** P2
**Severity:** High
**Depends on:** None
**Origin:** H-21

---

## Problem

`src/main/agent/agent-loop.ts` iterates the provider's `AsyncIterable<StreamChunk>` stream. If the provider throws mid-stream (network timeout, rate limit, 500 error), the error propagates as a `RUN_ERROR` event and the run ends. There is no retry, no partial-result recovery, and no fallback.

For transient failures (rate limits, network blips), the user loses the entire response and must manually resend.

## Implementation

- [ ] Detect retryable errors (HTTP 429, 500, 502, 503, network timeout) vs. permanent errors (401, 403, 400)
- [ ] For retryable errors: retry up to 2 times with exponential backoff (1s, 4s). Emit a `retrying` event so the renderer can show "Provider error, retrying..."
- [ ] For rate limits (429): parse `Retry-After` header if available; otherwise back off 10s
- [ ] After max retries: emit `RUN_ERROR` as today
- [ ] Don't retry if the user has cancelled (check AbortSignal before each retry)

## Files to Touch

- `src/main/agent/agent-loop.ts` — retry wrapper around stream iteration
- `src/shared/types/agent.ts` — add `retrying` event type (optional)
- `src/renderer/src/components/chat/ChatPanel.tsx` — show retry indicator (optional)

## Tests

- Unit: retryable error triggers retry with backoff
- Unit: permanent error does not retry
- Unit: AbortSignal prevents retry

## Risk if Skipped

Every transient provider error kills the entire agent run.
