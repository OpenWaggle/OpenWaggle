# TanStack AI Known Issues & Limitations

> Version tested: `@tanstack/ai@0.6.2`, `@tanstack/ai-react@0.6.3`, `@tanstack/ai-client@0.5.3`

This document tracks currently observed TanStack AI issues, limitations, and OpenWaggle workarounds. Historical references to a local `patch-package` TanStack patch have been removed because the repository no longer carries that patch.

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

**Workaround:** No general fix is currently implemented. We keep regression coverage around the behavior and tolerate the duplicate-card cosmetic failure mode rather than hiding potentially legitimate repeated tool calls.

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

**Upstream fix:** `@tanstack/ai-client@0.5.2` (PR #347) adds a `continuationSkipped` flag so that `checkForContinuation()` calls during an active stream are deferred and re-evaluated after the stream finishes. This eliminates the deadlock where approvals sent mid-stream were silently dropped.

**Previous workaround (removed):**
`waitForNotLoading()` polled the ChatClient's loading state before sending approval responses. This is no longer needed with the upstream fix and has been deleted.

**Remaining workaround:**
The ref-based approval tracking (`pendingApprovalTrustStatusRef`) is still needed — it prevents the React effect from self-cancelling when trust status transitions cause re-renders. This is a React concern, not a ChatClient concern.

---

## 5. Provider Streams Can Stall Mid-Tool-Args Before Any Tool Executes

**Severity:** High — prematurely terminates runs that were still safe to recover

**Problem:**
Anthropic/TanStack tool streams can stall while a tool call is still emitting its JSON arguments. The common production symptom is a `writeFile` call that starts with a valid `path` prefix, never finishes streaming `content`, and then times out with a partial payload such as:

```json
{"path":"docs/openwaggle-summary.md"
```

If this state is treated the same as a tool call that already reached `TOOL_CALL_END` and is awaiting approval or execution, the run fails too early and the user experiences an artificial stop instead of a safe recovery attempt.

**Root Cause:**
The raw `StreamChunk` flow distinguishes two materially different incomplete-tool states:

1. `TOOL_CALL_START` / `TOOL_CALL_ARGS` only
   - the model is still serializing JSON arguments
   - no tool execution has started yet
2. `TOOL_CALL_END` without `result`
   - the input is complete
   - the tool is awaiting approval, client execution, or result emission

Collapsing both into one generic "incomplete tool call" stall reason is too coarse. Only the second state is side-effect-sensitive.

**Workaround (implemented):**
OpenWaggle now classifies stalled streams into:

- `incomplete-tool-args`
- `awaiting-tool-result`
- `stream-stall`

Recovery policy:

- retry `incomplete-tool-args` stalls within the normal stall retry budget, because no tool has executed yet
- do **not** retry `awaiting-tool-result`, because re-running there can duplicate side effects

This workaround lives in:

- `/Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle/src/main/agent/stream-processor.ts`
- `/Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle/src/main/agent/agent-loop.ts`

---

## 6. `useChat` Foreground Runs Can Lose the Transcript After Client Recreation

**Severity:** High — can blank or stale the active transcript until a later refresh

**Problem:**
After a normal foreground run finishes, the TanStack `UIMessage[]` in the renderer can still be cleared later when the `useChat` client is recreated or its internal message state resets. If OpenWaggle keeps treating that run as "foreground-stream active" forever, the conversation hydration effect keeps bailing out and never restores either the persisted snapshot or the just-finished foreground transcript.

**Root Cause:**
OpenWaggle intentionally avoids replacing foreground-streaming `UIMessage[]` with persisted conversation snapshots, because persisted disk state can lag behind the live stream. But TanStack `useChat` also recreates internal client state when the hook `id` changes, and that can transiently reset `messages` to `[]`. If the foreground-stream guard is never cleared on the success path, later hydration attempts are suppressed indefinitely.

**Workaround (implemented):**
1. Keep the foreground guard active while the run is still authoritative.
2. Once the conversation is idle, cache the final foreground `UIMessage[]`.
3. If TanStack later resets `messages` to empty for the same conversation, restore that cached foreground snapshot exactly once.
4. Clear the foreground guard after the one-shot restore so normal persisted hydration can resume.

This workaround lives in:

- `/Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle/src/renderer/src/hooks/useAgentChat.ts`

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
| #4 continuation self-cancellation risk | Fixed upstream in `@tanstack/ai-client@0.5.2`; `waitForNotLoading` workaround removed | — |
| #6 foreground transcript loss after `useChat` reset | OpenWaggle renderer hydration regression | `src/renderer/src/hooks/__tests__/useAgentChat.unit.test.ts` |

### Upstream Fix Detection

`src/main/agent/tanstack-known-issues.unit.test.ts` includes a sentinel that asserts current TanStack behavior for continuation re-executions (end-only tool chunk emission).

If that sentinel starts failing after a TanStack upgrade, treat it as a likely upstream behavior change and re-evaluate:

1. whether issue #2 is now fixed upstream,
2. whether related workarounds can be simplified, and
3. whether this document should be updated.

---

## Evaluation

TanStack AI (`@tanstack/ai` + `@tanstack/ai-client`) still has significant gaps in its continuation/tool-approval flow. The issues above currently require:
- Multiple server-side workarounds (args enrichment, output enrichment, message normalization)
- Client-side workarounds (ref-based state tracking, idle waiting)
- Acceptance of cosmetic issues (duplicate tool cards)

Consider replacing TanStack AI with a thinner abstraction layer that gives more control over the tool execution lifecycle and message format.
