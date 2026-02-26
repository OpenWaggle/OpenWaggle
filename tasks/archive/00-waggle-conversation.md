# Waggle Conversation (North Star)

**Priority:** 0 — This is the product differentiator. Everything else serves this.
**Depends on:** Task 1 (approval flow) for safe tool use, Task 3 (error messages) for debuggability
**Blocks:** Nothing — can be built incrementally

---

## Vision

Two LLMs (same provider or different providers) have a conversation and co-work on a task together. Example: Codex and Opus discussing an architecture decision, each bringing different strengths. The user watches, intervenes when needed, and gets a better result than either model alone.

This is what no competitor offers. Cursor, Claude Code, Copilot — all single-model. OpenWaggle becomes the place where models collaborate.

## What Already Exists (Foundations)

The codebase is surprisingly well-prepared:

| Component | Status | Details |
|-----------|--------|---------|
| `Message.model` field | ✅ Ready | `src/shared/types/agent.ts:70` — optional `SupportedModelId` per message, already populated by `makeMessage()` in `shared.ts:24-38` |
| Model badges in UI | ✅ Ready | `MessageBubble.tsx` renders model name badge for each assistant message via `useMessageModelLookup` hook |
| Multi-provider adapters | ✅ Ready | `providerRegistry` in `src/main/providers/registry.ts` can create adapters for different providers simultaneously — no mutual exclusivity |
| Conversation persistence | ✅ Ready | `Conversation.messages` is a `Message[]` with per-message model tracking. Already persists/loads correctly. |
| Quality config per provider | ✅ Ready | `quality-config.ts:20-51` has model maps for all 6 providers × 3 presets |

## What Needs to Change

### Blocker 1: One active run per conversation

**File:** `src/main/ipc/agent-handler.ts:25-41`
```ts
const activeRuns = new Map<ConversationId, AbortController>()
// When a new message arrives, it ABORTS the existing run
```

The handler enforces one run at a time per conversation. For waggle, we need sequential turn-taking within a single conversation.

### Blocker 2: IPC stream chunks lack agent identity

**File:** `src/shared/types/ipc.ts`
```ts
'agent:stream-chunk': {
  payload: { conversationId: ConversationId; chunk: StreamChunk }
}
```

No `agentId` or `runId` field. If two agents stream into the same conversation, the renderer can't tell who's speaking.

### Blocker 3: No conversation coordinator

Nothing in the codebase orchestrates a back-and-forth between two models. The agent loop takes a single model and runs to completion.

## Architecture

### Phase 1 — Sequential Turn-Taking (MVP)

The simplest approach that delivers the core value. No concurrent streaming needed.

```
User sends message → Coordinator starts
  → Agent A (e.g., Opus) responds to the conversation
  → Agent A's response is appended to messages
  → Agent B (e.g., Codex) responds to the updated conversation (sees A's response)
  → Agent B's response is appended to messages
  → Coordinator checks: is the task done? Do they agree?
    → If not, loop back (Agent A responds to B's message)
    → If yes, or max turns reached, stop
User sees the full back-and-forth in real-time
```

**Why sequential first:**
- Reuses 90% of existing agent loop — just call `runAgent()` twice with different models
- No concurrent stream handling — simpler IPC, no race conditions
- Still delivers the core value: two models collaborating
- Natural conversation flow that users can follow

### Phase 2 — Concurrent Parallel Analysis (Later)

Both agents analyze the same input simultaneously, then a synthesis step merges their perspectives. This is the orchestration system upgraded.

### Phase 3 — Free-form Waggle (Later)

Agents can interrupt, ask each other questions, delegate sub-tasks. Requires more complex coordination.

## Implementation — Phase 1 Detail

### 1. Waggle Conversation Config

Create `src/shared/types/waggle.ts`:
```ts
interface WaggleConfig {
  /** The two models that will converse */
  agents: [AgentSlot, AgentSlot]
  /** Max back-and-forth turns before stopping (each agent response = 1 turn) */
  maxTurns: number
  /** Strategy for deciding when to stop */
  stopCondition: 'max-turns' | 'consensus' | 'user-stop'
  /** Optional system prompt override per agent */
  systemPromptOverrides?: [string | undefined, string | undefined]
}

interface AgentSlot {
  model: SupportedModelId
  /** Display name in the UI, e.g. "Architect" or "Reviewer" */
  label: string
  /** Role description injected into system prompt */
  roleDescription?: string
}
```

### 2. Waggle Coordinator

Create `src/main/agent/waggle-coordinator.ts`:

```ts
interface WaggleRunParams {
  conversation: Conversation
  payload: AgentSendPayload
  config: WaggleConfig
  settings: Settings
  onChunk: (agentIndex: number, chunk: StreamChunk) => void
  signal: AbortSignal
}

async function runWaggleConversation(params: WaggleRunParams): Promise<WaggleRunResult> {
  // 1. Append user message to conversation
  // 2. Loop up to maxTurns:
  //    a. Pick current agent (alternating: 0, 1, 0, 1, ...)
  //    b. Build system prompt with role description:
  //       "You are [label]. [roleDescription]. You are in a conversation with [other agent label].
  //        Review their previous response and build on it. Stay focused on the user's task."
  //    c. Call runAgent() with current agent's model
  //    d. Emit chunks tagged with agentIndex
  //    e. Append response to conversation messages
  //    f. Check stop condition
  // 3. Return all new messages
}
```

Key design decisions:
- **Reuse `runAgent()`** — don't rewrite the agent loop. The coordinator just calls it in sequence with different models.
- **Each agent sees the full conversation** — including the other agent's responses. This is what makes it a real conversation, not two isolated runs.
- **Role-aware system prompts** — each agent knows it's collaborating, what its role is, and who the other agent is.
- **User can intervene** — between turns, the user can add a message, redirect the conversation, or stop it.

### 3. IPC Changes

In `src/shared/types/ipc.ts`, add:
```ts
// New send channel
'agent:send-waggle-message': {
  args: [conversationId: ConversationId, payload: AgentSendPayload, config: WaggleConfig]
  return: undefined
}

// Extend stream chunk payload
'agent:stream-chunk': {
  payload: {
    conversationId: ConversationId
    chunk: StreamChunk
    agentIndex?: number      // NEW: which agent is streaming (0 or 1)
    agentLabel?: string      // NEW: human-readable label
  }
}
```

In `agent-handler.ts`, add a new handler for `'agent:send-waggle-message'` that:
- Creates the coordinator
- Manages the run lifecycle (abort, cleanup)
- Routes chunks with agent identity

### 4. Renderer — Agent Selector UI

The composer needs a way to configure waggle mode. Options:

**Option A — Minimal (recommended for MVP):**
- Add a "Collaborate" button next to the model selector
- Clicking it opens a small dialog: pick Model A, pick Model B, set max turns (default 6)
- When active, the composer shows both model names: "Opus + Codex"
- Send button triggers waggle flow

**Option B — Advanced (later):**
- Named agent slots with role descriptions
- Preset configurations ("Code Review: Opus reviews, Sonnet implements")
- Save/load agent team configs

**Files to modify:**
- `src/renderer/src/components/shared/ModelSelector.tsx` — add waggle toggle
- `src/renderer/src/components/composer/Composer.tsx` — waggle send flow
- `src/renderer/src/components/composer/ComposerStatusBar.tsx` — show active agents

### 5. Renderer — Conversation Display

`MessageBubble.tsx` already shows model badges. For waggle, enhance with:
- **Color-coded agent identity** — Agent A messages have one accent color, Agent B another
- **Agent label** — Show "Architect (Opus)" instead of just "Claude Opus 4"
- **Turn indicator** — "Turn 3 of 6" in the conversation flow
- **User intervention point** — Between agent turns, show a subtle "Add your input" prompt

**Files to modify:**
- `src/renderer/src/components/chat/MessageBubble.tsx` — agent colors, labels
- `src/renderer/src/components/chat/ChatPanel.tsx` — turn indicators, intervention UI

### 6. Stop Conditions

The coordinator needs to decide when to stop the back-and-forth:

**`max-turns`** (simplest): Stop after N turns. Default 6 (3 per agent).

**`consensus`** (smarter): After each turn, check if the agents are converging. Heuristics:
- Both agents produce similar outputs (cosine similarity > threshold)
- An agent explicitly says "I agree with the approach" or similar
- No new information added in the last turn

**`user-stop`**: Run indefinitely until user presses stop. Show a "Stop collaboration" button.

Start with `max-turns` for MVP. Add `consensus` detection later.

### 7. Tool Access in Waggle Mode

Both agents should have access to the same tool set. The coordinator runs each agent in the same `runWithToolContext()`. This means:
- Both agents can read/write files
- Approval gating works the same (Task 1 dependency)
- Tool calls are visible in the conversation (existing ToolCallBlock renders them)
- Agent B can see Agent A's tool results in the conversation history

**Risk:** Agent B might undo Agent A's file edits. Mitigations:
- Show a warning when Agent B tries to edit a file Agent A just modified
- Optional: give Agent B read-only access unless the user grants write

## Files to Create

- `src/shared/types/waggle.ts` — types and config
- `src/main/agent/waggle-coordinator.ts` — turn-taking orchestration
- `src/renderer/src/components/composer/WaggleSelector.tsx` — UI for picking two models

## Files to Modify

- `src/shared/types/ipc.ts` — new IPC channel, extended chunk payload
- `src/main/ipc/agent-handler.ts` — new handler, modify abort logic
- `src/main/utils/stream-bridge.ts` — include agentIndex in emission
- `src/renderer/src/lib/ipc-connection-adapter.ts` — pass agentIndex through
- `src/renderer/src/components/chat/MessageBubble.tsx` — agent colors/labels
- `src/renderer/src/components/chat/ChatPanel.tsx` — turn indicators
- `src/renderer/src/components/composer/Composer.tsx` — waggle send
- `src/renderer/src/components/shared/ModelSelector.tsx` — waggle toggle
- `src/renderer/src/stores/chat-store.ts` — track waggle state

## UX Flow (MVP)

1. User clicks "Collaborate" next to model selector
2. Picks two models (can be same provider or different)
3. Optionally sets roles: "You are the architect" / "You are the code reviewer"
4. Types a message and sends
5. Agent A responds (streamed, with model badge + color)
6. Agent B responds to A (streamed, different color)
7. Back and forth continues, user watches
8. User can inject a message at any point to redirect
9. After max turns or user stop, conversation is done
10. All messages are persisted with correct model attribution

## Relationship to Other Specs

- **Spec 01 (Approval Flow):** Waggle mode needs working approval for tool calls. Both agents trigger approvals independently.
- **Spec 02 (Orchestration Permissions):** If orchestration is used as the coordination layer, executors need write tools.
- **Spec 03 (Error Messages):** When one agent fails mid-conversation, the error needs to identify which agent failed and suggest recovery.
- **Spec 04 (MCP):** MCP tools should be available to both agents in waggle mode.
- **Spec 06 (Quality Presets):** In waggle mode, each agent slot has its own quality/model, making the preset system per-agent.
- **Spec 08 (Skills):** A "Code Review" skill becomes even more powerful when Agent A writes code and Agent B reviews it in the same conversation.

## What Makes This Hard

1. **Context window management** — Each turn adds tokens. With two agents, context fills 2x faster. Need to summarize or truncate older turns.
2. **Infinite loops** — Agents might keep "improving" forever without converging. Stop conditions must be robust.
3. **Conflicting actions** — Agent B edits a file Agent A just created differently. Need conflict detection or sequential-only tool access.
4. **Cost** — Two models per message = 2x API costs. Users need visibility into cost per turn.
5. **Latency** — Sequential turns mean the user waits for A, then waits for B. Total time is additive. Need clear progress indicators.

## What Makes This Unique

No one else does this. The closest is:
- ChatGPT Arena (compare outputs side-by-side, but no conversation between them)
- AutoGen/CrewAI (Python frameworks, not desktop apps, no real-time UI)
- Waggle research papers (not productized)

OpenWaggle would be the first desktop app where you pick two models, give them a task, and watch them collaborate in real-time with full tool access. That's the pitch.
