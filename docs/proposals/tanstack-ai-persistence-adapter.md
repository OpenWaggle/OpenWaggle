# RFC: Persistence Adapter for `useChat`

> Proposal for [TanStack/ai Discussions](https://github.com/TanStack/ai/discussions)

## Problem

`useChat` manages messages in React state (`useState`) — they're lost on unmount, page refresh, or app restart. There's no built-in way to persist conversations or restore them.

This forces every consumer to build the same coordination layer:

1. **Load** persisted messages into `useChat` via `setMessages()` on mount
2. **Guard** against persisted-state refreshes overwriting live stream messages during multi-run flows (continuations, tool approvals)
3. **Save** messages after the stream completes
4. **Reconnect** to in-progress streams when navigating back to an active conversation

In our Electron desktop app (where the LLM runs in a background process), this coordination layer is ~100 lines of refs, effects, and deferred-flush logic — all to answer one question: "who owns the messages right now, the live stream or the persistence layer?"

This pattern is common across any app that needs conversation history: web apps with database backends, mobile apps, desktop apps, or anything using localStorage.

## Proposed API

### Option A: Storage Adapter (minimal)

```typescript
interface ChatStorage {
  /** Load persisted messages for this conversation. Called on mount / id change. */
  load(id: string): Promise<UIMessage[]> | UIMessage[]
  /** Persist the current messages. Called after each completed run. */
  save(id: string, messages: UIMessage[]): Promise<void> | void
}

const chat = useChat({
  connection,
  id: conversationId,
  storage: myStorageAdapter,
})
```

`useChat` would internally:
- Call `storage.load(id)` on mount and when `id` changes — replaces `initialMessages`
- Skip `storage.load()` while a stream is active (the live stream is authoritative)
- Call `storage.save(id, messages)` after `onFinish` / run completion
- Expose a `chat.refresh()` method to manually re-load from storage

This eliminates the need for consumers to manage the "who owns messages" coordination.

### Option B: Lifecycle Callbacks (even more minimal)

If a full adapter is too opinionated, expose the lifecycle hooks that let consumers build it:

```typescript
const chat = useChat({
  connection,
  id: conversationId,
  onIdChange: async (newId, prevId) => {
    // Consumer loads messages from their store
    return loadMessagesFromDB(newId)
  },
  onRunComplete: async (id, messages) => {
    // Consumer persists after each completed run
    await saveMessagesToDB(id, messages)
  },
})
```

The key insight: `onIdChange` returns the messages to use, and `useChat` knows not to call it while a stream is active.

### Option C: Stream Reconnection (complementary)

For apps where the stream outlives the component (background processes, server-side streaming):

```typescript
const chat = useChat({
  connection,
  id: conversationId,
  storage: myStorageAdapter,
  reconnect: {
    /** Check if there's an active stream for this conversation */
    hasActiveStream: (id: string) => boolean,
    /** Get a connection to resume consuming the active stream */
    getActiveConnection: (id: string) => ConnectionAdapter,
  },
})
```

On mount / `id` change, `useChat` would check `hasActiveStream()` and either load from storage or reconnect to the live stream.

## Use Cases This Enables

| Use Case | Current (manual) | With Adapter |
|---|---|---|
| Load conversation on mount | `useEffect` + `setMessages()` | Automatic via `storage.load()` |
| Persist after stream completes | `onRunCompleted` IPC + `refreshConversationSnapshot()` | Automatic via `storage.save()` |
| Guard live stream from stale writes | `foregroundStreamActiveRef` | Handled internally by `useChat` |
| Navigate away and back | Manual background stream manager + reconnection | `reconnect` option handles it |
| App restart / page refresh | Manual load from DB + `setMessages()` | Automatic via `storage.load()` |

## Real-World Context

We're building an Electron desktop coding agent ([OpenWaggle](https://github.com/OpenWaggle/OpenWaggle)). Our architecture:

- **Main process**: Agent loop, tool execution, LLM calls, SQLite persistence
- **Renderer**: React UI using `useChat` for stream processing
- **IPC bridge**: Messages flow between processes via Electron IPC

The coordination layer we maintain today:
- `foregroundStreamActiveRef` — prevents persisted-snapshot sync from overwriting live stream
- `deferredSnapshotRefreshCountRef` — defers persistence reads during send/steer flows
- `refreshConversationSnapshot()` — re-reads from main process after run completes
- `reconnectToBackgroundRun()` — manually rebuilds UIMessages from persisted parts + live chunks
- `backgroundStreaming` state — tracks when we're showing a reconnected stream vs. TanStack's native stream

All of this exists because `useChat` doesn't know about persistence. A storage adapter would collapse it into a single config object.

## Compatibility

- **Non-breaking**: `storage` is an optional new field. Existing behavior is unchanged without it.
- **Composable**: Works with existing `initialMessages` (as fallback when `storage.load()` returns empty).
- **Framework-agnostic**: The `ChatStorage` interface can be implemented for localStorage, IndexedDB, SQLite, REST APIs, or any backend.

## References

- [Discussion: "doc for persistence? like what ai sdk have?"](https://github.com/TanStack/ai/discussions)
- [Discussion: "Need streaming callbacks in chat for persistence"](https://github.com/TanStack/ai/discussions)
- [ElectricSQL: Durable Sessions pattern](https://electric-sql.com/blog/2026/01/12/durable-sessions-for-collaborative-ai)
- [TanStack DB persistence discussion (#865)](https://github.com/TanStack/db/issues/865)
- TanStack Query's storage persister pattern (prior art in the ecosystem)
