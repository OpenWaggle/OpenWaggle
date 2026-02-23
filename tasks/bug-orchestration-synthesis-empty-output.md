# Bug: Orchestration synthesis returns empty output — `modelText` silently swallows `RUN_ERROR` chunks

## Status
Resolved — `64be6b5`

## Severity
P1 — User-facing data loss in orchestration mode

## Observed Behavior

When orchestration mode runs a multi-task plan, the synthesis step (final LLM call that combines task outputs into a coherent answer) returns empty text. The user sees task narrations, tool activity, and completion summaries, but the response ends abruptly with `---` and no final answer.

### Log evidence

```
12:13:35.070 [orchestration] synthesis starting {"taskCount":3,"outputKeys":["read-project-docs","read-packages","read-specs"]}
12:13:35.070 [orchestration] modelText: calling chat() {"promptLength":10235}
12:13:37.031 [orchestration] modelText: chat() returned {"outputLength":0}
12:13:37.031 [orchestration] synthesis completed {"resultLength":0}
```

- 3 executor tasks completed successfully (4893, 109, and 100 chars respectively)
- Synthesis prompt was 10235 chars (well within limits)
- **2-second response time** for a 10k prompt — too fast for a real model response, strongly suggests an API error returned quickly
- `outputLength: 0` — no text content captured

## Root Cause Analysis

### Primary: `modelText` silently drops `RUN_ERROR` stream chunks

`src/main/orchestration/service.ts:430-436` — The `modelText` function iterates the TanStack `chat()` stream but only handles 3 chunk types:

```typescript
for await (const chunk of stream) {
  if (chunk.type === 'TEXT_MESSAGE_CONTENT') {
    result += chunk.delta
  } else if (chunk.type === 'STEP_STARTED' || chunk.type === 'STEP_FINISHED') {
    onChunk?.(chunk)
  }
  // RUN_ERROR, RUN_STARTED, RUN_FINISHED, TEXT_MESSAGE_START,
  // TEXT_MESSAGE_END — ALL silently dropped
}
```

When the Anthropic adapter encounters an API error (400, 429, 5xx, network error), it yields a `RUN_ERROR` chunk:

```typescript
// node_modules/@tanstack/ai-anthropic/src/adapters/text.ts:135-146
catch (error: unknown) {
  const err = error as Error & { status?: number; code?: string }
  yield {
    type: 'RUN_ERROR',
    model: options.model,
    timestamp: Date.now(),
    error: {
      message: err.message || 'Unknown error occurred',
      code: err.code || String(err.status),
    },
  }
}
```

TanStack's `chat()` activity **does yield `RUN_ERROR` to the consumer** (`node_modules/@tanstack/ai/src/activities/chat/index.ts:442` — `yield chunk` happens before `handleStreamChunk`). Then it sets `earlyTermination = true` and the stream ends.

Our `modelText` receives this chunk, doesn't match any condition, drops it, the stream ends, and it returns `"".trim()` → empty string.

### Secondary: `modelTextWithTools` has the same flaw

`src/main/orchestration/service.ts:472-510` — The executor variant also doesn't handle `RUN_ERROR`:

```typescript
for await (const chunk of stream) {
  if (chunk.type === 'TEXT_MESSAGE_CONTENT') { ... }
  else if (chunk.type === 'STEP_STARTED' || chunk.type === 'STEP_FINISHED') { ... }
  else if (chunk.type === 'TOOL_CALL_START') { ... }
  else if (chunk.type === 'TOOL_CALL_ARGS') { ... }
  else if (chunk.type === 'TOOL_CALL_END') { ... }
  // RUN_ERROR silently dropped here too
}
```

In this test run, executor calls succeeded so this wasn't triggered, but the same silent-failure mode exists.

### Tertiary: No empty-output guard in the synthesis path

Even if the empty output came from legitimate model behavior (e.g., thinking-only response with no text), the synthesis path doesn't detect it:

1. **`service.ts:271`** — `modelText` returns `""`, no error thrown
2. **`orchestrator.ts:112`** — `synthesizer.synthesize()` returns `""`, no error thrown (the `catch` on line 117 only catches exceptions, not empty returns)
3. **`orchestrator.ts:126-132`** — Returns `{ text: "" }` to the caller
4. **`service.ts:361-363`** — Streams empty text after `---\n\n` separator:
   ```typescript
   appendText('---\n\n')
   await streamText(emitChunk, ackMessageId, orchestrationResult.text) // ""
   fullText += orchestrationResult.text // ""
   ```
5. User sees `---` followed by nothing.

### Contributing factor: `modelJson` (planner) has a different failure mode

`service.ts:515-543` — If the planner's `modelText` returns empty due to `RUN_ERROR`, `modelJson` tries `JSON.parse("")` which throws, then `extractJson("")` which throws, then falls back to `{ tasks: [] }`. An empty task array means no orchestration happens. This is a silent degradation — the planner error is swallowed and the user gets no response instead of a fallback.

## Full Data Flow

```
User sends message
  → runOrchestratedAgent()
    → modelJson(plannerPrompt) → modelText() → chat() stream
      → [Planner succeeds, returns task plan]
    → runOpenHiveOrchestration()
      → engine.run() — executes tasks via modelTextWithTools()
        → [Task 1: 4893 chars ✓]
        → [Task 2: 109 chars ✓]
        → [Task 3: 100 chars ✓]
      → synthesizer.synthesize()
        → modelText(synthesisPrompt) → chat() stream
          → Anthropic adapter: API error → yields RUN_ERROR chunk
          → chat() activity: yields chunk to consumer, sets earlyTermination
          → modelText: RUN_ERROR chunk falls through if/else → DROPPED
          → modelText: stream ends → returns ""
        ← synthesize() returns ""
      ← runOpenHiveOrchestration returns { text: "" }
    → streamText(emitChunk, messageId, "") → nothing streamed
    → User sees: narrations + tool activity + "---" + [nothing]
```

## Probable API Error Trigger

The 2-second response time (vs 5-30 seconds for normal responses) strongly indicates a quick API error return. Possible causes:

1. **Rate limiting (429)**: 5 API calls (1 planner + 3 executors + 1 synthesis) within ~40 seconds may exceed rate limits for some Anthropic API tiers
2. **Request validation error (400)**: Edge case in parameter construction for the synthesis call specifically (e.g., some interaction between thinking params and the request format)
3. **Transient server error (5xx)**: Server-side issue on that specific request

Without the actual error message (which was silently dropped), we cannot determine which. **This is itself part of the bug** — the error is invisible.

## Impact

- **User-facing**: The most important part of the orchestrated response (the synthesized answer) is missing. Users see task activity but no final coherent answer.
- **Silent failure**: No error indicator in the UI. The response looks like it finished normally, just with no content after the separator.
- **Debugging blind spot**: The error message from the API is silently dropped. `outputLength: 0` is logged but not flagged as abnormal. Impossible to diagnose without reading source code.
- **Affects all orchestration providers**: The `modelText`/`modelTextWithTools` pattern is provider-agnostic — any provider adapter that yields `RUN_ERROR` will be silently swallowed.

## Reproduction

1. Enable orchestration mode
2. Use a model with extended thinking enabled (Anthropic Claude with thinking config)
3. Ask a question that triggers multi-task orchestration (e.g., "what can you do?")
4. Observe: task narrations and tool activity stream correctly, but the final synthesis after `---` is empty
5. Check logs: `synthesis completed {"resultLength":0}` confirms the issue

Note: This may be intermittent depending on rate limit state and API health.

## Recommended Fix

### 1. Make `modelText` throw on `RUN_ERROR` (critical)

```typescript
async function modelText(adapter, prompt, quality, onChunk): Promise<string> {
  // ... existing setup ...

  let result = ''
  for await (const chunk of stream) {
    if (chunk.type === 'TEXT_MESSAGE_CONTENT') {
      result += chunk.delta
    } else if (chunk.type === 'STEP_STARTED' || chunk.type === 'STEP_FINISHED') {
      onChunk?.(chunk)
    } else if (chunk.type === 'RUN_ERROR') {
      const code = chunk.error?.code ?? 'unknown'
      const message = chunk.error?.message ?? 'Model returned an error'
      logger.error('modelText: RUN_ERROR received', { code, message })
      throw new Error(`Model error [${code}]: ${message}`)
    }
  }
  // ... existing return ...
}
```

Apply the same fix to `modelTextWithTools`.

### 2. Add empty-output guard in synthesis (defense in depth)

In `orchestrator.ts`, treat empty synthesis output the same as a thrown error:

```typescript
text = await input.synthesizer.synthesize({ userPrompt, plan, run })
if (!text.trim()) {
  logger.warn('synthesis returned empty output, concatenating task outputs')
  text = concatenateOutputs(run)
}
```

### 3. Add empty-output guard for planner (defense in depth)

In `modelJson`, log a warning when `modelText` returns empty before attempting JSON parse:

```typescript
const text = await modelText(adapter, prompt, quality, onChunk)
if (!text.trim()) {
  logger.warn('modelJson: modelText returned empty — possible swallowed error')
}
```

### 4. Consider synthesis retry (optional)

The synthesis call is cheap relative to the executor work that's already done. A single retry with a brief delay would handle transient API errors:

```typescript
let text: string
for (let attempt = 0; attempt < 2; attempt++) {
  try {
    text = await input.synthesizer.synthesize({ userPrompt, plan, run })
    if (text.trim()) break
    logger.warn('synthesis returned empty, retrying', { attempt })
  } catch (error) {
    if (attempt === 1) {
      text = concatenateOutputs(run)
      break
    }
  }
}
```

## Key Files

| File | Role | Issue |
|------|------|-------|
| `src/main/orchestration/service.ts:411-441` | `modelText` — core LLM call wrapper | Silently drops `RUN_ERROR` chunks |
| `src/main/orchestration/service.ts:443-513` | `modelTextWithTools` — executor LLM wrapper | Same `RUN_ERROR` drop |
| `src/main/orchestration/service.ts:515-543` | `modelJson` — planner LLM wrapper | Falls back to `{ tasks: [] }` on empty |
| `src/main/orchestration/service.ts:255-275` | Synthesis callback | Doesn't guard against empty result |
| `packages/condukt-openhive/src/orchestrator.ts:110-124` | Synthesis invocation | Catches thrown errors but not empty returns |
| `node_modules/@tanstack/ai-anthropic/src/adapters/text.ts:135-146` | Adapter error handling | Yields `RUN_ERROR` (correct behavior) |
| `node_modules/@tanstack/ai/src/activities/chat/index.ts:440-448` | Chat activity stream | Yields chunk before handling (correct) |

## Verification After Fix

1. `pnpm test:unit` — existing tests still pass
2. Add unit test: `modelText` throws when stream contains `RUN_ERROR`
3. Add unit test: synthesis falls back to `concatenateOutputs` on empty result
4. Manual test: trigger orchestration and verify synthesis output appears after `---`
5. Manual test: artificially trigger API error (invalid key) and verify error is surfaced, not silently dropped
