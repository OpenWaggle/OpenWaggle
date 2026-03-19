# TanStack AI Known Issues & Limitations

> Version tested: `@tanstack/ai@0.8.1`, `@tanstack/ai-anthropic@0.7.0`, `@tanstack/ai-react@0.7.2`

This document tracks **open** TanStack AI issues, limitations, and OpenWaggle workarounds. Solved issues are removed — see git history for past entries.

---

## 1. Missing `TOOL_CALL_START` / `TOOL_CALL_ARGS` Chunks for Continuation Re-executions

**Package:** `@tanstack/ai`

**Severity:** Medium → High (causes #2 without patch)

**Problem:**
When `emitToolResults()` re-executes a tool during a continuation, it only emits a `TOOL_CALL_END` chunk. No `TOOL_CALL_START` or `TOOL_CALL_ARGS` chunks are emitted, causing client-side `StreamProcessor` to store tool calls with empty arguments `{}`.

**Root Cause:**
`buildToolResultChunks()` in `activities/chat/index.ts` iterates pending tool calls and yields only `TOOL_CALL_END` after execution. The `TOOL_CALL_START` and `TOOL_CALL_ARGS` chunk types are only emitted during the initial LLM streaming response.

**Patch (applied locally):**
In `checkForPendingToolCalls()`, build an `argsMap` from the pending `ToolCall` objects and pass it to `buildToolResultChunks()`. Before each `TOOL_CALL_END`, emit `TOOL_CALL_START` and `TOOL_CALL_ARGS` with the original arguments. Patch applied via `pnpm patch @tanstack/ai` — see `patches/@tanstack__ai@0.8.1.patch`.

**Status:** Patched locally. Ready to PR upstream.

**Remaining workaround:**
Server-side args enrichment in `agent-loop.ts` is still in place as a safety net. Can be removed once the patch is confirmed stable or merged upstream.

---

## 2. UIMessage Parts Corruption Across Continuation Streams

**Package:** `@tanstack/ai-client` (downstream of #1)

**Severity:** High — causes infinite approval loops without patch/workaround

**Problem:**
TanStack AI's `ChatClient` doesn't preserve tool-call `arguments` correctly across continuation streams. Without the #1 patch, the client stores empty arguments and the TextEngine treats every approved tool as "pending execution", re-executing ALL tools on every continuation.

**Root Cause:**
The `ChatClient` (`@tanstack/ai-client`) reconstructs UIMessages from stream chunks. Without the #1 patch, continuation re-executions only emit `TOOL_CALL_END`, so the client never receives arguments for re-executed tools.

**Patch:** Fixed by the #1 patch — continuation re-executions now emit the full `TOOL_CALL_START` + `TOOL_CALL_ARGS` + `TOOL_CALL_END` sequence.

**Remaining workaround:**
1. `normalizeContinuationAsUIMessages()` preserves UIMessage format with parts instead of converting to ModelMessages, allowing the TextEngine to extract approval state
2. Server-side args + output enrichment from `conversation.messages` (safety net)
3. `mergeConsecutiveAssistantUIMessages()` prevents Anthropic API alternating-role violations

---

## Regression Coverage Matrix

Run all known-issue regression coverage with:

```bash
pnpm test:tanstack-known-issues
```

| Issue | Coverage Type | Tests |
| --- | --- | --- |
| #1 continuation chunk emission | Patch sentinel (asserts full START+ARGS+END sequence) | `src/main/agent/__tests__/tanstack-known-issues.unit.test.ts` |
| #1 + #2 continuation normalization | OpenWaggle normalization/collector regressions | `src/main/agent/continuation-normalizer.unit.test.ts`, `src/main/agent/stream-part-collector.unit.test.ts` |
| #3 transcript loss after client recreation | Local patch + regression | `src/renderer/src/hooks/__tests__/useAgentChat.unit.test.ts` |

### Patch Regression Detection

`src/main/agent/__tests__/tanstack-known-issues.unit.test.ts` asserts that continuation re-executions emit the full `TOOL_CALL_START` + `TOOL_CALL_ARGS` + `TOOL_CALL_END` sequence (our patch).

If this test fails after a TanStack upgrade, the patch may have been overwritten — re-apply it and re-evaluate whether the fix was merged upstream.

---

## Evaluation

TanStack AI has bugs across two packages, all patched locally:
- `@tanstack/ai` — continuation chunk emission (#1, #2) patched via `patches/@tanstack__ai@0.6.2.patch`
- `@tanstack/ai-react` — messagesRef staleness (#3) patched via `patches/@tanstack__ai-react.patch`

Server-side enrichment workarounds for #1/#2 remain as safety nets until patches are confirmed stable or merged upstream.
