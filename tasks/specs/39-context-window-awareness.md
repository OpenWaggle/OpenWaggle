# 39 — Context Window Awareness

**Status:** Planned
**Priority:** P3
**Category:** Feature
**Depends on:** None (benefits from Spec 38 token tracking)
**Origin:** Identified as missing during multi-agent review — Spec 00 explicitly flags "context fills 2x faster" as a hard problem

---

## Problem

There is no mechanism to detect, warn about, or mitigate context window exhaustion. When a conversation approaches the model's context limit:

1. The provider API returns an error (usually truncation or a 400)
2. The user sees a cryptic error message
3. The entire conversation becomes unusable
4. The user must start a new conversation and re-explain everything

This is already a problem with single-agent conversations. With multi-agent mode (2x token accumulation per turn), it becomes critical. The multi-agent spec (Spec 00, archived) explicitly calls this out: "Context window management — Each turn adds tokens. With two agents, context fills 2x faster."

## What Exists

- Each model has a known context window size (available in the provider registry / model definitions)
- Token counting is partially available (if Spec 38 is implemented, per-message counts are known)
- No token counting utility exists today — no way to estimate conversation size in tokens
- No truncation/summarization mechanism exists
- No UI indicator of context utilization

## Architecture

### Context Tracking

```
Each message has approximate token count
  → Running total maintained in conversation state
  → Compared against model's context limit (from provider registry)
  → Utilization percentage: tokens_used / context_limit
  → Warning thresholds: 60% (yellow), 80% (orange), 95% (red/block)
```

### Token Counting Strategy

Exact token counting requires per-model tokenizers (tiktoken for OpenAI, Anthropic's tokenizer, etc.). For v1, use a **heuristic**:
- English text: ~4 characters per token (conservative)
- Code: ~3.5 characters per token
- Estimate from `message.content.length / 3.8` (average)
- Refine with actual usage data from Spec 38 when available

### Context Limits (current models)

| Model | Context Window |
|-------|---------------|
| Claude Opus 4.6 | 200K tokens |
| Claude Sonnet 4.5 | 200K tokens |
| Claude Haiku 4.5 | 200K tokens |
| GPT-5.2 | 1M tokens |
| GPT-5 | 128K tokens |
| Gemini 2.5 Pro | 1M tokens |
| Gemini 2.5 Flash | 1M tokens |

## Implementation

### Phase 1: Context utilization tracking

- [ ] Create `src/shared/utils/token-counter.ts`
  - `estimateTokens(text: string): number` — heuristic-based
  - `getModelContextLimit(modelId: string): number` — from provider registry
  - `getContextUtilization(messages: Message[], modelId: string): { used: number; limit: number; percentage: number }`
- [ ] Track running token count in conversation state
- [ ] If Spec 38 is implemented, use actual token counts instead of estimates

### Phase 2: UI indicator

- [ ] Context meter in conversation header or composer area
  - Subtle progress bar showing context utilization
  - Color-coded: green (< 60%), yellow (60-80%), orange (80-95%), red (> 95%)
  - Tooltip: "~45,000 / 200,000 tokens used (22%)"
- [ ] Warning banner at 80% utilization:
  - "This conversation is using 80% of the context window. Consider starting a new conversation or using Conversation Handoff."
- [ ] Block/warn at 95%:
  - "This conversation has nearly exhausted its context window. Your next message may fail. [Start New Conversation] [Continue Anyway]"

### Phase 3: Automatic mitigation

- [ ] **Smart truncation**: When approaching limit, offer to summarize older messages
  - Keep recent N messages in full
  - Summarize older messages into a compact "conversation so far" block
  - Use a cheap model (Haiku) for summarization
  - User must approve before truncation happens
- [ ] **Conversation handoff**: Integrate with Spec 19 (Conversation Handoff, done)
  - "Continue this conversation in a new thread with context summary"
  - One-click action that creates new conversation with summary + recent messages

### Phase 4: Multi-agent context management

- [ ] In multi-agent mode, show per-agent context usage
  - Each agent may be using a different model with different limits
  - Show: "Architect (Opus): 45K/200K | Reviewer (Sonnet): 38K/200K"
- [ ] Multi-agent coordinator should check context before each turn
  - If either agent is approaching limit, warn before starting the turn
  - Option: "Agent A is at 85% context. Stop collaboration and present results?"

## Files to Create

- `src/shared/utils/token-counter.ts` — estimation + context tracking
- `src/renderer/src/components/chat/ContextMeter.tsx` — utilization indicator
- `src/renderer/src/components/chat/ContextWarning.tsx` — warning/block banners

## Files to Modify

- `src/renderer/src/components/chat/ChatPanel.tsx` — render context meter
- `src/renderer/src/components/composer/Composer.tsx` — pre-send context check
- `src/main/agent/multi-agent-coordinator.ts` — per-turn context check
- `src/shared/types/agent.ts` — add context metadata to conversation

## Tests

- Unit: token estimation produces reasonable counts for code and text
- Unit: context utilization calculation correct for various conversation sizes
- Unit: warning thresholds trigger at correct percentages
- Component: context meter renders with correct color at each threshold
- Unit: multi-agent coordinator checks context before each turn
