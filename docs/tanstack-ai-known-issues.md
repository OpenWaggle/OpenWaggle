# TanStack AI Known Issues & Limitations

> Version tested: `@tanstack/ai@0.6.1` (patched), `@tanstack/ai-client@0.5.1`

This document tracks known issues, limitations, and workarounds related to our use of TanStack AI. These are inherent to the library and cannot be fixed without patching or replacing the dependency.

---

## 1. Tool Re-execution Duplication on Continuations

**Severity:** Medium — cosmetic/UX impact, no data corruption

**Problem:**
When a tool requires approval and the agent run ends (yielding control back to the client), the next continuation run re-executes the approved tool via `emitToolResults()` inside the TextEngine. After re-execution, the model sometimes proposes a **duplicate tool call** with the same name and arguments, resulting in the tool appearing twice in the UI.

**Root Cause:**
The TextEngine's continuation flow works as follows:
1. Run 1: Model proposes tool call → tool needs approval → run ends
2. Client approves → new `runAgent()` continuation
3. Run 2: TextEngine calls `checkForPendingToolCalls()` → finds approved tool → `emitToolResults()` re-executes it
4. After re-execution, the model sees the tool result and may propose the **same tool call again** (non-deterministic but frequent)

This is an inherent behavior of TanStack AI's `TextEngine` continuation handling. The model doesn't reliably distinguish between "tool already executed via continuation" and "tool needs to be called."

**Observed in:** Sequential tool calls (test A1), continuation checks, any flow involving tool approval.

**Workaround:** None available without patching the TextEngine. Could potentially be mitigated by post-processing duplicate tool calls in the UI layer, but this risks hiding legitimate repeated calls.

---

## 2. Missing `TOOL_CALL_START` / `TOOL_CALL_ARGS` Chunks for Continuation Re-executions

**Severity:** Medium — requires server-side enrichment workaround

**Problem:**
When `emitToolResults()` re-executes a tool during a continuation, it only emits a `TOOL_CALL_END` chunk. No `TOOL_CALL_START` or `TOOL_CALL_ARGS` chunks are emitted, causing `StreamPartCollector` to store the tool call with empty arguments `{}`.

**Root Cause:**
`emitToolResults()` in `activities/chat/index.js` iterates pending tool calls and yields only `TOOL_CALL_END` after execution. The `TOOL_CALL_START` and `TOOL_CALL_ARGS` chunk types are only emitted during the initial LLM streaming response.

**Workaround (implemented):**
Server-side enrichment in `agent-loop.ts`: before passing continuation messages to `chat()`, we enrich UIMessage tool-call parts with correct arguments and output from the server's stored `conversation.messages`. A non-empty args guard prevents re-execution empty args from overwriting correct args:

```typescript
if (Object.keys(part.toolCall.args).length > 0) {
  toolArgsMap.set(String(part.toolCall.id), argsStr)
}
```

---

## 3. UIMessage Parts Corruption Across Continuation Streams

**Severity:** High — causes infinite approval loops without workaround

**Problem:**
TanStack AI's `ChatClient` doesn't preserve tool-call `arguments` correctly across continuation streams. The client-side UIMessages may have corrupted or empty arguments after a continuation, and tool output is not stored on `tool-call` parts. Without enrichment, the TextEngine treats every approved tool as "pending execution" and re-executes ALL tools on every continuation.

**Root Cause:**
The `ChatClient` (`@tanstack/ai-client`) reconstructs UIMessages from stream chunks. Since continuation re-executions only emit `TOOL_CALL_END` (see issue #2), the client never receives the arguments for re-executed tools and stores them as empty.

**Workaround (implemented):**
1. `normalizeContinuationAsUIMessages()` preserves UIMessage format with parts instead of converting to ModelMessages, allowing the TextEngine to extract approval state
2. Server-side args + output enrichment from `conversation.messages` (see issue #2 workaround)
3. `mergeConsecutiveAssistantUIMessages()` prevents Anthropic API alternating-role violations

---

## 4. `continuationPending` State Can Cause Effect Self-Cancellation

**Severity:** High — causes deadlock without workaround

**Problem:**
When using `ChatClient.continuationPending` as a React state dependency in an effect that also triggers continuations, the effect can cancel itself. The state change from `continuationPending` flipping causes React to re-run the effect, cleaning up the previous run before the continuation completes.

**Workaround (implemented):**
Replace `continuationPending` state dependency with a ref (`pendingApprovalTrustStatusRef`) that doesn't trigger re-renders. Also added `waitForNotLoading()` to defer approval until the ChatClient is idle.

---

## Regression Coverage Matrix

Run all known-issue regression coverage with:

```bash
pnpm test:tanstack-known-issues
```

| Issue | Coverage Type | Tests |
| --- | --- | --- |
| #1 duplicate continuation tool cards | OpenWaggle workaround regression | `src/renderer/src/components/chat/useVirtualRows.unit.test.ts` |
| #2 end-only continuation tool chunks | Upstream behavior sentinel + OpenWaggle normalization/collector regressions | `src/main/agent/tanstack-known-issues.unit.test.ts`, `src/main/agent/continuation-normalizer.unit.test.ts`, `src/main/agent/stream-part-collector.unit.test.ts` |
| #3 continuation UIMessage/tool-arg corruption | OpenWaggle normalization regression | `src/main/agent/continuation-normalizer.unit.test.ts` |
| #4 continuation self-cancellation risk | OpenWaggle idle-wait workaround regression | `src/renderer/src/components/chat/wait-for-not-loading.unit.test.ts` |

### Upstream Fix Detection

`src/main/agent/tanstack-known-issues.unit.test.ts` includes a sentinel that asserts current TanStack behavior for continuation re-executions (end-only tool chunk emission).

If that sentinel starts failing after a TanStack upgrade, treat it as a likely upstream behavior change and re-evaluate:

1. whether issue #2 is now fixed upstream,
2. whether related workarounds can be simplified, and
3. whether this document should be updated.

---

## Evaluation

TanStack AI (`@tanstack/ai` + `@tanstack/ai-client`) is still early-stage and has significant gaps in its continuation/tool-approval flow. The issues above required:
- A patched version of `@tanstack/ai`
- Multiple server-side workarounds (args enrichment, output enrichment, message normalization)
- Client-side workarounds (ref-based state tracking, idle waiting)
- Acceptance of cosmetic issues (duplicate tool cards)

Consider replacing TanStack AI with a thinner abstraction layer that gives more control over the tool execution lifecycle and message format.
