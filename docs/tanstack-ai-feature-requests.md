# TanStack AI Feature Requests

> Upstream features we'd like to see in `@tanstack/ai` / `@tanstack/ai-react` that would simplify OpenWaggle.

---

## 1. Background Stream Reconnection API

**Problem:**
`useChat` assumes the client is the sole consumer of the stream. When the user navigates away from a conversation with an active run and navigates back, there's no API to reconnect to the in-progress stream.

**Current workaround:**
~50 lines of manual IPC plumbing in `useAgentChat.ts`: check `hasActiveRun()`, fetch persisted parts, subscribe to `onStreamChunk()`, manage `backgroundStreaming` state.

**Proposed API:**
```typescript
const { reconnect } = useChat({ connection })
await reconnect(existingStreamId)
```

**Status:** To be filed on `TanStack/ai`.

---

## 2. Persistence Adapter for `useChat`

**Problem:**
`useChat` manages messages purely in-memory. Every consumer that needs persistence must build the same coordination layer: load on mount, guard live streams from stale writes, save after completion, reconnect on navigation.

**Current workaround:**
~100 lines of refs, effects, and deferred-flush logic in `useAgentChat.ts` to answer "who owns the messages right now, the live stream or the persistence layer?"

**Proposed API:**
```typescript
interface ChatStorage {
  load(id: string): Promise<UIMessage[]> | UIMessage[]
  save(id: string, messages: UIMessage[]): Promise<void> | void
}

const chat = useChat({
  connection,
  id: conversationId,
  storage: myStorageAdapter,
})
```

**Status:** Full proposal drafted at `docs/proposals/tanstack-ai-persistence-adapter.md`.

---

## 3. Stream Timeout Support

**Problem:**
No layer in the stack (Anthropic SDK → TanStack adapter → TanStack `streamModelResponse()`) applies a stream-level timeout. If the provider API stalls mid-chunk (e.g. partial tool-call JSON), `for await` blocks indefinitely.

**Current workaround:**
OpenWaggle's `stream-processor.ts` races `iterator.next()` against a 120-second timeout via `Effect.raceFirst`, then classifies stalls as `incomplete-tool-args` (retryable), `awaiting-tool-result` (not retryable), or `stream-stall` (retryable). The agent loop retries safe stalls up to 2 times with backoff.

**Proposed API:**
```typescript
const stream = chat({
  adapter,
  messages,
  tools,
  timeout: 120_000, // optional stream-level timeout per chunk
})
```

Or at the adapter level:
```typescript
const adapter = createAnthropicAdapter({
  apiKey,
  timeout: 120_000,
})
```

**Status:** Not a bug — enhancement. Our workaround is production-ready and more flexible (domain-aware stall classification). Low priority to file upstream.
