# Spec 19 — Conversation Handoff

**Goal**: When a conversation gets long and context degrades, one-click "continue in new conversation" that carries over everything that matters — what was done, what's in progress, what's left, and the current state of the code. No more spending 10 minutes re-explaining your project every time you start a new conversation.

**Status**: Planned

**Depends on**: None (complements Spec 14 Codebase Memory but works independently)

---

## The Problem

Context windows are finite. Every coding agent hits this wall:

1. Conversation goes well for 30-40 messages
2. Context fills up, older messages get compressed or dropped
3. Agent starts forgetting earlier decisions, repeating mistakes, contradicting itself
4. User starts a new conversation
5. New conversation knows nothing — user re-explains the project, the task, the approach, the constraints
6. 10 minutes lost. If the task was mid-implementation, it's worse: "I was refactoring the payment module, I've done files A, B, C, files D and E still need changes, and here's the pattern I'm following..."

This happens multiple times per day for heavy agent users. It's a tax on every session.

---

## Architecture

### Handoff Document

When the user triggers handoff, the agent generates a structured summary:

```markdown
# Conversation Handoff

## Task
[What the user asked for — extracted from the original request]

## Approach
[The strategy/architecture decided during the conversation]

## Completed
- [x] Refactored `src/main/payment.ts` — extracted `PaymentService` class
- [x] Updated `src/main/routes/payment.ts` — new endpoints
- [x] Added Zod schemas in `src/shared/schemas/payment.ts`

## In Progress
- [ ] Update `src/main/tests/payment.test.ts` — tests for new PaymentService methods
- [ ] Wire new endpoints in `src/main/index.ts`

## Key Decisions
- Using class-based service (not functional) because it needs stateful connection pooling
- Zod schemas shared between main and renderer via @shared/ path alias
- Error handling follows existing pattern in `src/main/services/auth.ts`

## Current File State
[Auto-generated: list of files modified in this conversation with brief description of changes]

## Warnings
- `PaymentService.refund()` is half-implemented — the Stripe API call is stubbed
- Tests will fail until `payment.test.ts` is updated
```

### Handoff Flow

```
User clicks "Continue in new conversation" (or /handoff command)
  → Agent generates handoff document from conversation context
  → New conversation is created
  → Handoff document injected as opening system context
  → Agent in new conversation reads the handoff and continues where it left off
  → Old conversation is marked as "handed off → [new conversation ID]"
  → New conversation is marked as "continued from → [old conversation ID]"
```

---

## Implementation

### Phase 1: Handoff Generation

- [ ] Create `src/main/agent/handoff-generator.ts`
  - `generateHandoff(conversation: Conversation): Promise<string>`
  - Uses the current agent (same model) to summarize the conversation into the handoff format
  - Structured prompt that extracts: task, approach, completed items, in-progress items, decisions, warnings
  - Includes list of files modified during the conversation (from tool call history)
  - Includes relevant code snippets for in-progress work (not full files, just the context needed)
  - Token budget: handoff document should be < 4K tokens (enough to be useful, small enough to leave room)

- [ ] Create handoff prompt template
  - Input: full conversation history
  - Output: structured handoff document
  - Key instructions:
    - "Focus on what the NEXT agent needs to know to continue the work"
    - "Include specific file paths and line numbers for in-progress changes"
    - "List decisions with rationale — the next agent shouldn't re-debate settled questions"
    - "Flag anything that's broken or half-done as a warning"
    - "Do NOT include general project knowledge (that's what CLAUDE.md is for)"

### Phase 2: Handoff Execution

- [ ] Add IPC channel: `conversation:handoff`
  - Args: `conversationId: ConversationId`
  - Returns: `{ newConversationId: ConversationId, handoffDocument: string }`
  - Flow:
    1. Generate handoff document from current conversation
    2. Create new conversation
    3. Inject handoff as first system message in new conversation
    4. Link old → new conversation (bidirectional metadata)
    5. Return new conversation ID to renderer
- [ ] Add conversation metadata fields
  - `handoffTo?: ConversationId` — on the source conversation
  - `handoffFrom?: ConversationId` — on the target conversation
  - Persisted in conversation JSON

### Phase 3: Renderer UI

- [ ] "Continue in new conversation" button
  - Appears in conversation header / overflow menu
  - Also triggered by `/handoff` command in composer
  - Shows loading state while handoff document is generated ("Preparing handoff...")
  - Auto-navigates to new conversation when ready
- [ ] Handoff indicator in conversation list
  - Source conversation shows: "Handed off → [new conversation title]" link
  - Target conversation shows: "Continued from → [old conversation title]" link
  - Visual chain: user can trace the full history across conversations
- [ ] Handoff preview (optional)
  - Before creating new conversation, show the handoff document
  - User can edit/annotate: "also remember that the API rate limit is 100 req/min"
  - Confirm to proceed

### Phase 4: Auto-Handoff Suggestion

- [ ] Detect context degradation
  - Heuristics:
    - Conversation exceeds N messages (configurable, default 40)
    - Agent starts repeating information it already provided
    - Agent asks about something it already discussed
    - Context compression has occurred (system notification)
  - When detected: show non-blocking suggestion "Context is getting long. Continue in a new conversation?"
  - Not automatic — just a nudge

### Phase 5: Handoff Quality

- [ ] Post-handoff verification
  - After new conversation starts, agent reads the handoff document
  - Agent confirms understanding: "I'm continuing your work on [task]. I see you've completed [X] and [Y] is in progress. I'll pick up from [Z]."
  - If something is unclear, agent asks before proceeding
- [ ] Handoff + Spec 14 integration
  - If codebase memory (Spec 14) is available, the handoff document is stored as a high-relevance memory note
  - Future conversations (not just the immediate next one) can reference this handoff context
  - The handoff becomes part of the project's institutional memory

---

## What Goes in the Handoff vs What Doesn't

| Include | Don't Include |
|---------|--------------|
| Current task and approach | General project knowledge (that's CLAUDE.md) |
| Specific files modified + what changed | Full file contents (agent can read them) |
| Decisions with rationale | Chat banter, greetings, clarifications |
| In-progress work with exact state | Completed work details (just list what's done) |
| Warnings about broken/half-done things | Tool call logs |
| Relevant code patterns being followed | Every error that was encountered and fixed |

**Target: < 4K tokens.** Enough to continue seamlessly, small enough to leave room for actual work.

---

## Difference from Spec 14 (Codebase Memory)

| | Handoff (Spec 19) | Memory (Spec 14) |
|---|---|---|
| **Scope** | Active work-in-progress state | Long-term architectural knowledge |
| **Lifetime** | One-time transfer to next conversation | Persists across all conversations |
| **Content** | Task, approach, progress, warnings | Module relationships, patterns, decisions |
| **Trigger** | User-initiated (or suggested) | Passive, continuous |
| **Format** | Structured document | Knowledge graph + notes |

They complement each other: memory provides the "what is this codebase" context, handoff provides the "what am I doing right now" context.

---

## Files to Create

- `src/main/agent/handoff-generator.ts` — generates handoff document from conversation
- `src/renderer/src/components/chat/HandoffButton.tsx` — UI trigger
- `src/renderer/src/components/chat/HandoffPreview.tsx` — preview/edit before handoff

## Files to Modify

- `src/shared/types/agent.ts` — add handoff metadata to Conversation type
- `src/shared/types/ipc.ts` — handoff IPC channel
- `src/main/ipc/conversation-handler.ts` — handoff execution
- `src/main/persistence/conversations.ts` — persist handoff links
- `src/renderer/src/components/sidebar/ConversationList.tsx` — handoff chain indicators
- `src/renderer/src/stores/chat-store.ts` — handoff state

---

## Verification

- [ ] Handoff document captures task, approach, completed/in-progress items, decisions
- [ ] New conversation receives handoff and agent correctly continues work
- [ ] Conversations are linked bidirectionally (source ↔ target)
- [ ] Handoff document stays within 4K token budget
- [ ] User can edit handoff document before confirming
- [ ] Context degradation detection suggests handoff at appropriate time
- [ ] Agent in new conversation confirms understanding before proceeding
- [ ] Handoff chain is visible in conversation list (trace history across conversations)
