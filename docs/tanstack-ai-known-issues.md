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

**Status:** Fix merged upstream via [TanStack/ai#372](https://github.com/TanStack/ai/pull/372). Local patch (`patches/@tanstack__ai@0.8.1.patch`) still applied because the fix is not yet published to npm (latest is `0.10.1`). Once a new version is released that includes the fix, bump `@tanstack/ai`, remove the patch, and evaluate removing safety-net workarounds in `agent-continuation.ts` and `continuation-normalizer.ts`.

**Remaining workaround:**
Server-side args enrichment in `agent-continuation.ts` is still in place as a safety net. Can be removed once the upstream fix is published and confirmed stable.

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

## 4. Repeated `TEXT_MESSAGE_START` Events Create Extra Assistant UIMessages in Multi-Turn Wrappers

**Package:** `@tanstack/ai-react`

**Severity:** High for wrapper orchestration flows (Waggle turns mis-render live)

**Problem:**
`useChat`/TextEngine creates one assistant `UIMessage` per unique `TEXT_MESSAGE_START.messageId`. In wrappers that represent one logical turn across multiple continuation phases, repeated `TEXT_MESSAGE_START` events with new IDs generate extra assistant messages mid-turn. This breaks turn-level metadata mapping and live rendering order.

**Root Cause:**
`handleTextMessageStartEvent()` in `@tanstack/ai-react` routes by `messageId` and calls `ensureAssistantMessage()`. A new `messageId` means a new assistant message, even if the higher-level orchestration still considers it the same turn.

**OpenWaggle workaround:**
Normalize `TEXT_MESSAGE_START` / `TEXT_MESSAGE_CONTENT` / `TEXT_MESSAGE_END` chunk IDs to a stable per-turn ID before emitting stream chunks. Apply this normalization consistently to both:
1. `agent:stream-chunk` (UI message assembly)
2. `waggle:stream-chunk` (live messageId → turn metadata lookup)

**Status:** Mitigated in OpenWaggle stream adapter layer. Upstream behavior is still ID-driven by design.

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
| #4 repeated TEXT_MESSAGE_START IDs in wrappers | Stream normalization + renderer/e2e guardrails | `src/main/ipc/__tests__/waggle-handler.unit.test.ts`, `src/renderer/src/components/chat/__tests__/useBuildChatRows.unit.test.ts`, `e2e/waggle-streaming-rendering.e2e.test.ts` |

## 5. Codex `response.incomplete` Kills Tool Continuation Loop

**Package:** `@tanstack/ai-openai`

**Severity:** High (agentic workflows silently broken on Codex subscription)

**Problem:**
When the Codex subscription endpoint (`chatgpt.com/backend-api/codex/responses`) exhausts its server-side output token budget, it sends `response.incomplete` instead of `response.completed`. The adapter yields `RUN_ERROR` for `response.incomplete`, which sets `earlyTermination = true` in the TextEngine. The engine's `shouldContinue()` returns `false` because `lastFinishReason` is never set to `'tool_calls'`. Tool calls generated in the response are never executed, and no continuation is sent.

**Root Cause:**
The OpenAI adapter already observes streamed function calls earlier in the response via `response.output_item.added` and stores them in `toolCallMetadata`, but its terminal mapping keyed the continuation decision off `response.incomplete.response.output.some(function_call)`. Codex incomplete responses do not reliably repeat streamed tool calls in that terminal `response.output` payload, so the adapter emitted `RUN_ERROR` even after it had already streamed valid tool-call chunks.

**Workaround:**
Patched in `patches/@tanstack__ai-openai@0.7.1.patch` (adapter text.ts + text.js):
1. **Primary fix:** Track stream-observed tool calls with adapter-local state (`hasObservedToolCalls` plus `toolCallMetadata.size` backup). On `response.incomplete`, if tool calls were already observed in the stream, yield `RUN_FINISHED` with `finishReason: 'tool_calls'` and skip the generic `RUN_ERROR` path.
2. **Duplicate-terminal guard:** Once the adapter has emitted a synthetic `RUN_FINISHED(tool_calls)`, ignore later `response.completed`, `response.failed`, and `error` terminal chunks so they cannot overwrite the continuation boundary with a conflicting stop/error event.
3. **Secondary fix:** After the `for await` loop, if no terminal decision was emitted but tool calls were collected (`toolCallMetadata.size > 0`), yield a synthetic `RUN_FINISHED` with `finishReason: 'tool_calls'`. This handles streams that end without any terminal event.

Additionally, the Codex endpoint rejects all token-limit parameters (`max_output_tokens`, `max_tokens`, `max_completion_tokens`) and several others (`metadata`, `user`, `context_management`). These are stripped in `src/main/providers/openai.ts` via `CODEX_UNSUPPORTED_PARAMS`.

**References:**
- https://github.com/BerriAI/litellm/issues/21193
- https://github.com/openai/codex/issues/4138

### Patch Regression Detection

`src/main/agent/__tests__/tanstack-known-issues.unit.test.ts` asserts that:
1. Continuation re-executions emit the full `TOOL_CALL_START` + `TOOL_CALL_ARGS` + `TOOL_CALL_END` sequence (patch #1/#2).
2. A `RUN_FINISHED(tool_calls)` after tool call chunks triggers tool execution and continuation (patch #5).

If these tests fail after a TanStack upgrade, the patches may have been overwritten — re-apply and re-evaluate whether fixes were merged upstream.

---

## Evaluation

TanStack AI has bugs across two packages, all patched locally:
- `@tanstack/ai@0.8.1` — continuation chunk emission (#1, #2) patched via `patches/@tanstack__ai@0.8.1.patch`
- `@tanstack/ai-openai@0.7.1` — Codex `response.incomplete` tool continuation (#5) patched via `patches/@tanstack__ai-openai@0.7.1.patch`
- `@tanstack/ai-react@0.7.2` — messagesRef staleness (#3) fixed upstream (PR #373), no local patch needed

Server-side enrichment workarounds for #1/#2 remain as safety nets until patches are confirmed stable or merged upstream.
