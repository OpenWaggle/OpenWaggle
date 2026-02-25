# 21 — Agent Loop Integration Test

**Status:** Planned
**Priority:** P4
**Severity:** Strategic
**Depends on:** None
**Origin:** H-14

---

## Problem

The highest-risk code path — user sends message, agent loop streams response, tool calls execute, results return — has no integration test that exercises the full pipeline with a mock provider.

## Implementation

- [ ] Create `src/main/agent/__tests__/agent-loop.integration.test.ts`
- [ ] Mock a provider that returns a canned tool-call stream (e.g., `readFile` call, then text response)
- [ ] Assert: tool executes with correct args, result feeds back into stream, final message contains expected text, events emitted in correct order
- [ ] Test case 2: provider returns error mid-stream. Assert: error event emitted, conversation state consistent
- [ ] Test case 3: user cancels mid-stream via AbortSignal. Assert: stream stops, no dangling promises

## Files to Touch

- `src/main/agent/__tests__/agent-loop.integration.test.ts` (new)
- May need a test helper to create a mock `ProviderDefinition`

## Tests

- Integration: happy path with tool calls
- Integration: mid-stream error handling
- Integration: AbortSignal cancellation
