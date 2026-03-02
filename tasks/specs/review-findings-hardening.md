# Review Findings Hardening

Fix four validated issues from code review: plan manager memory leak, chat store O(n) reload, spawn-agent circular dependency, and silent error dropping in feature registry.

---

## Fix 1: Plan Manager TTL + Conversation Deletion Cleanup

**Problem:** `plan-manager.ts` pending plans wait forever. If a conversation is deleted while a plan is pending, the Map entry leaks.

**Root cause:** Two gaps:
1. No TTL on pending proposals — `waitForPlanResponse` blocks indefinitely unless caller provides an AbortSignal
2. `conversations:delete` IPC handler (`conversations-handler.ts:28-30`) does not call `cleanupConversationRun()` before deleting

**Fix:**

### 1a. Add TTL to `waitForPlanResponse`

In `src/main/tools/plan-manager.ts`:

- Add a `PLAN_PROPOSAL_TTL_MS` constant (e.g. 10 minutes)
- In `waitForPlanResponse`, start a `setTimeout` that auto-rejects the promise after TTL
- Clean up the timer in `respondToPlan`, `cancelPlanProposal`, and on abort signal
- Use `try/finally` with `clearTimeout` to prevent leaked timers

```
waitForPlanResponse(conversationId, signal?) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cancelPlanProposal(conversationId)
    }, PLAN_PROPOSAL_TTL_MS)

    registerPlanProposal(
      conversationId,
      (response) => { clearTimeout(timer); resolve(response) },
      (error) => { clearTimeout(timer); reject(error) },
    )

    // existing abort signal handling...
    // add clearTimeout in abort handler too
  })
}
```

### 1b. Cleanup on conversation deletion

In `src/main/ipc/conversations-handler.ts`:

- Import `cleanupConversationRun` from `agent-handler.ts` (or extract it to a shared module if circular import issues arise)
- Call it before `deleteConversation(id)` in the `conversations:delete` handler
- Also call it in `conversations:archive` handler (archived conversations shouldn't have active plans either)

**If `cleanupConversationRun` creates a circular import** (agent-handler → conversations-handler cycle), extract the cleanup function to a small shared module like `src/main/agent/conversation-cleanup.ts` that both handlers import.

**Files to modify:**
- [x] `src/main/tools/plan-manager.ts` — add TTL
- [x] `src/main/ipc/conversations-handler.ts` — add cleanup call
- [x] Possibly extract cleanup function to avoid circular imports

**Tests:**
- Unit test: plan auto-rejects after TTL expires
- Unit test: conversation deletion cancels pending plan

---

## Fix 2: Chat Store Optimistic Updates

**Problem:** `createConversation`, `deleteConversation`, and `updateConversationProjectPath` all call `loadConversations()` which does a full IPC round-trip to re-fetch the entire conversation list.

**Root cause:** Pessimistic update pattern — every mutation reloads the full list as the sync mechanism.

**Fix:** Apply optimistic local updates with error rollback.

In `src/renderer/src/stores/chat-store.ts`:

### 2a. `createConversation` — append instead of reload

```typescript
async createConversation(projectPath) {
  const conv = await api.createConversation(projectPath)
  const summary: ConversationSummary = {
    id: conv.id,
    title: conv.title,
    projectPath: conv.projectPath,
    messageCount: 0,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
  }
  set((s) => ({
    conversations: [summary, ...s.conversations],
    activeConversationId: conv.id,
    activeConversation: conv,
  }))
  return conv.id
}
```

Note: Zustand's `set` doesn't support functional updaters with `get()` in the same way — use `get()` before `set()`:

```typescript
async createConversation(projectPath) {
  const conv = await api.createConversation(projectPath)
  const summary: ConversationSummary = { /* built from conv */ }
  const conversations = [summary, ...get().conversations]
  set({ conversations, activeConversationId: conv.id, activeConversation: conv })
  return conv.id
}
```

### 2b. `deleteConversation` — filter instead of reload

```typescript
async deleteConversation(id) {
  const prev = get().conversations
  // Optimistic: remove immediately
  set({ conversations: prev.filter(c => c.id !== id) })
  const { activeConversationId } = get()
  if (activeConversationId === id) {
    set({ activeConversationId: null, activeConversation: null })
  }
  try {
    await api.deleteConversation(id)
  } catch (err) {
    // Rollback on failure
    set({ conversations: prev })
    handleStoreError(err, 'delete conversation', set)
  }
}
```

### 2c. `updateConversationProjectPath` — patch instead of reload

```typescript
async updateConversationProjectPath(id, projectPath) {
  const updated = await api.updateConversationProjectPath(id, projectPath)
  if (!updated) return
  const conversations = get().conversations.map(c =>
    c.id === id ? { ...c, projectPath } : c
  )
  set({ conversations })
  if (get().activeConversationId === id) {
    set({ activeConversation: updated })
  }
}
```

**Files to modify:**
- [x] `src/renderer/src/stores/chat-store.ts` — replace three mutations

**Tests:**
- Update `chat-store.unit.test.ts`:
  - Verify `createConversation` prepends to list without calling `listConversations`
  - Verify `deleteConversation` removes from list optimistically
  - Verify `deleteConversation` rolls back on API error
  - Verify `updateConversationProjectPath` patches in-place

---

## Fix 3: Spawn-Agent Dependency Injection

**Problem:** `spawn-agent.ts:49` uses `await import('../../sub-agents/sub-agent-runner')` to break a circular dependency: `spawn-agent → sub-agent-runner → agent-loop → built-in-tools → spawn-agent`.

**Root cause:** `built-in-tools.ts` statically imports `spawnAgentTool`, but `spawnAgentTool` needs `runSubAgent` which depends on `runAgent` from `agent-loop`, which depends on tools from `built-in-tools.ts`.

**Fix:** Late-bind the `runSubAgent` function via a setter on the facade module.

### 3a. Add a registration function to `sub-agents/facade.ts`

```typescript
// In facade.ts — add late-binding for runSubAgent
type RunSubAgentFn = (input: RunSubAgentInput) => Promise<SubAgentResult>
let _runSubAgent: RunSubAgentFn | null = null

export function registerRunSubAgent(fn: RunSubAgentFn): void {
  _runSubAgent = fn
}

export function getRunSubAgent(): RunSubAgentFn {
  if (!_runSubAgent) {
    throw new Error('runSubAgent not registered — call registerRunSubAgent() at startup')
  }
  return _runSubAgent
}
```

### 3b. Register at app startup

In `src/main/index.ts` (or wherever `registerAllProviders()` is called):

```typescript
import { runSubAgent } from './sub-agents/sub-agent-runner'
import { registerRunSubAgent } from './sub-agents/facade'
registerRunSubAgent(runSubAgent)
```

### 3c. Update `spawn-agent.ts` to use the facade

Replace the lazy `await import()` with:
```typescript
import { getRunSubAgent } from '../../sub-agents/facade'

// in execute():
const runSubAgent = getRunSubAgent()
```

This eliminates the lazy import while keeping `spawn-agent.ts` decoupled from `sub-agent-runner.ts` at the static import level. The circle is broken because `facade.ts` doesn't import `sub-agent-runner.ts` — the binding happens at runtime during app initialization.

**Files to modify:**
- [x] `src/main/sub-agents/facade.ts` — add register/get pattern
- [x] `src/main/tools/tools/spawn-agent.ts` — replace lazy import with facade getter
- [x] App startup file (likely `src/main/index.ts`) — register the function

**Tests:**
- Verify spawn-agent tool throws clear error if called before registration
- Verify existing spawn-agent tests still pass with the new wiring

---

## Fix 4: Feature Registry Error Logging

**Problem:** `summarizeToolError` in `feature-registry.ts:113-139` returns `undefined` when JSON parses successfully but has no recognized error keys (`error`, `message`, `text`). No logging, so unrecognized error shapes disappear silently.

**Fix:** Add a `logger.debug` call for the unrecognized-shape case.

In `src/main/agent/feature-registry.ts`, at the end of `summarizeToolError` (line 139):

```typescript
// Current: return undefined
// Change to:
logger.debug('Tool error result has no recognized error key', {
  keys: Object.keys(record)
})
return undefined
```

Also add logging for the `safeParse` failure case (line 123):

```typescript
if (!result.success) {
  logger.debug('Tool error result failed schema validation', {
    preview: String(parsed).slice(0, 200),
  })
  return undefined
}
```

**Files to modify:**
- [x] `src/main/agent/feature-registry.ts` — two `logger.debug` additions

**Tests:**
- No new tests needed — this is observability-only. Verify existing tests still pass.

---

## Implementation Order

1. **Fix 4** (feature registry logging) — trivial, zero risk, immediate value
2. **Fix 1** (plan manager TTL + deletion cleanup) — isolated, clear scope
3. **Fix 2** (chat store optimistic updates) — renderer-only, needs test updates
4. **Fix 3** (spawn-agent DI) — touches startup wiring, needs careful verification

## Verification

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test:unit` passes
- [ ] `pnpm lint` passes
- [ ] No regressions in plan proposal flow (manual: create plan → approve → verify)
- [ ] No regressions in conversation CRUD (manual: create, rename, delete, archive)
