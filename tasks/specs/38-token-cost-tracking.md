# 38 — Token & Cost Tracking

**Status:** Planned
**Priority:** P3
**Category:** Feature
**Depends on:** None
**Origin:** Identified as missing during waggle review — no UI stub, no spec, but critical for waggle mode (2x cost)

---

## Problem

Users have zero visibility into how many tokens they're consuming or how much each conversation costs. This is especially acute with:

1. **Waggle mode** (Spec 00, done): two models per turn = 2x token consumption. Users can't see this.
2. **Orchestration mode**: planner + N executors + synthesizer = multiple API calls per user message.
3. **Model diversity**: switching between Opus ($15/MTok) and Haiku ($0.25/MTok) has a 60x cost difference. Users pick models with no cost feedback.

Every competitor shows some form of token/cost tracking: ChatGPT shows usage in account settings, Claude shows tokens in the API console, Cursor shows monthly usage. OpenWaggle shows nothing.

## What Exists

The information is already flowing through the system — it's just not surfaced:

- **TanStack AI stream chunks** include token usage data in `RUN_FINISHED` events (varies by provider adapter)
- **Provider adapters** receive usage metadata from each API call
- **`Message` type** (`src/shared/types/agent.ts`) could carry token counts per message
- **Conversation persistence** already stores full message arrays — adding token fields is backward-compatible

## Architecture

### Data Flow

```
Provider API response (includes usage)
  → TanStack adapter yields RUN_FINISHED with token counts
  → agent-loop.ts captures usage from stream
  → Stored per-message: { inputTokens, outputTokens, model, estimatedCost }
  → Aggregated per-conversation: total tokens, total cost
  → Displayed in UI: per-message, per-turn, per-conversation, session total
```

### Cost Estimation

Each provider publishes pricing. Store a static `MODEL_PRICING` map:

```typescript
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6': { input: 15.0, output: 75.0 },       // per million tokens
  'claude-sonnet-4-5': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5': { input: 0.25, output: 1.25 },
  'gpt-5.2': { input: 2.0, output: 8.0 },
  // ... etc
}
```

Costs are **estimates** — actual billing depends on caching, batching, etc. Show as "~$0.03" with a tooltip explaining it's an estimate.

## Implementation

### Phase 1: Capture token usage from stream

- [ ] In `src/main/agent/agent-loop.ts`: extract `usage` from `RUN_FINISHED` stream chunks
- [ ] Add `tokenUsage?: { inputTokens: number; outputTokens: number }` to `Message` type
- [ ] Store token counts when persisting conversation messages
- [ ] Backward-compatible: existing conversations without token data show "—"

### Phase 2: Cost estimation engine

- [ ] Create `src/shared/utils/cost-estimator.ts`
  - `estimateCost(model, inputTokens, outputTokens): number`
  - `MODEL_PRICING` map for all supported models
  - Returns USD amount
- [ ] Aggregate per-conversation: sum all message token costs
- [ ] Aggregate per-session: sum all conversations in current app session

### Phase 3: Per-message display

- [ ] In `MessageBubble.tsx`: show subtle token count + estimated cost beneath each assistant message
  - Format: "1,247 tokens · ~$0.02"
  - Only show for assistant messages (user messages have negligible cost)
  - Collapsed by default, visible on hover or via a toggle
- [ ] For waggle messages: show per-agent cost + combined
  - "Architect (Opus): 2,100 tokens · ~$0.16  |  Reviewer (Sonnet): 1,500 tokens · ~$0.02"

### Phase 4: Conversation-level summary

- [ ] In conversation header or sidebar: show total conversation cost
  - "This conversation: ~$0.47 (12,340 tokens)"
- [ ] In sidebar conversation list: show cost badge on each conversation
- [ ] Add IPC channel: `'conversations:get-usage'` → returns per-conversation token/cost summary

### Phase 5: Session dashboard (optional)

- [ ] Settings or dedicated panel: session usage across all conversations
  - "Today: ~$2.13 across 8 conversations"
  - Breakdown by model
  - Daily/weekly trend

## Waggle Cost Implications

Waggle mode (Spec 00) creates compound costs that are invisible today:

| Scenario | Single Agent | Waggle (6 turns) |
|----------|-------------|----------------------|
| Simple question | ~1K tokens, ~$0.01 | ~6K tokens, ~$0.06 |
| Complex task (Opus) | ~10K tokens, ~$0.75 | ~60K tokens, ~$4.50 |

Without cost visibility, users can accidentally burn $5+ on a single waggle conversation. This spec makes that transparent.

## Files to Create

- `src/shared/utils/cost-estimator.ts` — pricing map + estimation logic
- `src/renderer/src/components/chat/TokenUsage.tsx` — per-message token display

## Files to Modify

- `src/shared/types/agent.ts` — add `tokenUsage` to `Message`
- `src/main/agent/agent-loop.ts` — capture usage from RUN_FINISHED
- `src/main/store/conversations.ts` — persist token data
- `src/renderer/src/components/chat/MessageBubble.tsx` — render token/cost
- `src/renderer/src/components/layout/Sidebar.tsx` — cost badge on conversations

## Tests

- Unit: cost estimator returns correct values for known models
- Unit: token usage extracted from mock RUN_FINISHED chunks
- Unit: backward-compatible load of conversations without token data
- Component: token display renders for assistant messages, hidden for user messages
