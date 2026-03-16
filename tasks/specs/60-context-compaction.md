# 60 — Context Compaction

**Status:** Not Started
**Priority:** P2
**Category:** Architecture
**Depends on:** None (independent of rendering/waggle fixes)
**Enables:** Waggle synthesis redesign, long conversation reliability

---

## Problem

As conversations grow — especially after waggle mode runs with multiple agents and tool calls — the context sent to the LLM can easily exceed 50k+ tokens. This causes:

1. **Degraded output quality** — models lose focus with bloated context
2. **Cost explosion** — every follow-up carries the entire history
3. **Context window overflow** — switching to a smaller model can break a conversation
4. **Waggle amplification** — a 5-turn waggle with tool calls generates massive context that persists into normal mode

### Current State

- No context budget awareness — full conversation history is sent to every API call
- No compaction mechanism — old tool traces, resolved discussions, and waggle transcripts accumulate indefinitely
- Model switching doesn't trigger any context re-evaluation
- Waggle synthesis tries to compress via a 3000-char-per-turn truncation (inadequate)

---

## Design Decisions

### Naming
"Compaction" — not compression, not summarization. Compaction.

### Budget Calculation
- **Normal mode:** Budget = active model's context window × 0.8 (20% headroom for system prompt + response)
- **Waggle mode:** Budget = min(Agent A window, Agent B window) × 0.8 — use the smallest window to ensure neither model is degraded

### When to Compact

Compaction is triggered **dynamically**, not at fixed points:

1. **Before an API call** — if estimated token count exceeds the model's budget
2. **On model switch** — re-evaluate immediately; a conversation that fits in 200k may overflow 128k
3. **During waggle turns** — between turns, if approaching the min-window budget
4. **Mid-task execution** — at natural break points (between tool calls, between agent loop iterations), not mid-stream

Compaction should behave like garbage collection: runs when there's a natural pause, not when the user is actively waiting.

### What Gets Compacted (in priority order)

1. **Old tool call traces** — tool args + results from completed tool calls (keep tool name + brief outcome)
2. **Waggle turn transcripts** — raw multi-turn debate (replace with structured summary)
3. **Resolved discussions** — earlier conversation segments that led to completed actions
4. **Redundant file contents** — same file read multiple times (keep only the latest version reference)

### What is NOT Compactable

- **Recent messages** — last N messages always preserved verbatim (user needs context continuity)
- **Active file contents** — files currently being worked on
- **User instructions** — explicit directions from the user
- **System prompt** — always sent in full
- **Current task context** — whatever the agent is actively working on

### Compaction Strategy

Progressive, oldest-first:
1. Start with the oldest, least-relevant segments
2. Tool traces go first (highest compression ratio, lowest information loss)
3. Then old conversation turns
4. Only compact recent material as a last resort

### UX — What the User Sees

**Minimal. No summary dumps.**

- Brief indicator: "Compacting context..." → done → conversation continues
- No expandable summary of what was compacted
- No token counts or technical details
- The user just sees the conversation continue naturally

**The original messages remain visible in the UI** — compaction only affects what gets sent to the LLM, not what's rendered on screen. The persisted messages are untouched.

**During mid-task compaction:**
- No visible interruption — the agent compacts between steps and continues seamlessly
- The user may not even notice it happened

### Waggle → Normal Mode Transition

When waggle ends:
1. Waggle status goes to `idle`
2. A "Waggle complete · N turns" divider appears in the UI
3. The user's normal model takes over — **first response gets full context** (no compaction yet)
4. On subsequent turns, waggle transcript messages are candidates for compaction
5. Waggle turn messages keep their colors in the UI forever (visual history)
6. The normal model's responses have **no color** — absence of color signals "back to normal"

The current `runSynthesisStep` in the coordinator is **removed**. The "synthesis" is simply the normal model's first response after waggle — it naturally synthesizes because it has the full transcript. The synthesis prompt should encourage actionable suggestions without forcing execution.

---

## Implementation

### Phase 1: Token Budget Infrastructure

- [ ] Create `src/main/context/token-budget.ts`:
  - `getModelContextWindow(model: SupportedModelId): number` — returns context window size
  - `estimateTokenCount(messages: Message[]): number` — fast token estimation (chars/4 or tiktoken)
  - `shouldCompact(messages: Message[], model: SupportedModelId): boolean`
  - `getCompactionBudget(model: SupportedModelId): number` — window × 0.8
- [ ] For waggle: `getWaggleBudget(agents: WaggleConfig['agents']): number` — min of agent windows × 0.8

### Phase 2: Message Mapper Integration

- [ ] Update the message mapper (converts persisted messages → API messages) to be budget-aware:
  - Before building API messages, check `shouldCompact()`
  - If compaction needed, identify compactable segments
  - Replace compactable segments with summaries
  - Cache the compacted representation for reuse
- [ ] Compaction produces a single `[compacted]` message that replaces N older messages in the API call
- [ ] Original messages remain in persistence — only the API view is compacted

### Phase 3: Tool Trace Compaction

- [ ] Implement tool trace compaction (highest ROI, simplest):
  - Tool call: keep name + brief args summary
  - Tool result: keep success/failure + first 200 chars
  - Full tool traces available in UI but not sent to API after compaction
- [ ] This alone should handle most context overflow scenarios

### Phase 4: Waggle Transcript Compaction

- [ ] When waggle turn messages are compacted:
  - Replace N turn messages with a structured summary
  - Summary includes: agent labels, key conclusions, points of agreement/disagreement
  - Generated lazily on first compaction need, then cached
- [ ] Remove `runSynthesisStep` from waggle-coordinator
- [ ] Add waggle-complete divider event
- [ ] Wire normal model to respond after waggle with full context (first turn) then compact on subsequent turns

### Phase 5: Model Switch Re-evaluation

- [ ] On model switch, re-evaluate context budget
- [ ] If new model has smaller window and current context exceeds it, compact before next API call
- [ ] UI shows brief "Compacting context for [model name]..." if needed

### Phase 6: Mid-Task Compaction

- [ ] In agent loop, check budget between tool call iterations
- [ ] If approaching limit, compact older context before continuing
- [ ] Agent continues seamlessly — no visible interruption
- [ ] Log compaction events for debugging

---

## File Cache Invalidation

The waggle shared file cache (from PR #13) needs write-awareness:

- [ ] When `writeFile` or `editFile` tools execute successfully during a waggle session:
  - Invalidate the cache entry for that file path
  - Next read gets fresh content from disk
- [ ] Add `invalidate(filePath: string): void` to `WaggleFileCache`
- [ ] Wire invalidation in the write/edit tool implementations when `context.waggle` is present

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/main/context/token-budget.ts` | Budget calculation, model window lookup, compaction triggers |
| `src/main/context/compactor.ts` | Compaction logic — tool traces, conversation segments, waggle transcripts |
| `src/main/context/compaction-cache.ts` | Cache for compacted representations |

## Files to Modify

| File | Change |
|------|--------|
| `src/main/agent/agent-loop.ts` | Budget check between tool iterations |
| `src/main/agent/waggle-coordinator.ts` | Remove `runSynthesisStep`, add waggle-complete event, budget check between turns |
| `src/main/agent/waggle-file-cache.ts` | Add `invalidate()` method |
| `src/main/tools/tools/write-file.ts` | Invalidate file cache on write |
| `src/main/tools/tools/edit-file.ts` | Invalidate file cache on edit |
| Message mapper (TBD) | Budget-aware message building |
| Renderer waggle components | Waggle-complete divider, remove synthesis UI expectations |

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Compaction loses critical context | High | Progressive strategy — compact oldest/least-relevant first; never compact recent messages or user instructions |
| Compaction latency blocks user | Medium | Run at natural break points; fast token estimation; cache compacted results |
| Inconsistent context between waggle agents | Medium | Single budget (min window) shared by both agents |
| Token estimation inaccuracy | Low | Use conservative estimates; 20% headroom provides buffer |
| Model window data goes stale | Low | Maintain a lookup table; update when adding new model support |

## Definition of Done

1. Conversations with 100k+ tokens of history continue functioning after model switch to smaller window
2. Waggle runs don't cause context overflow on subsequent normal-mode turns
3. Compaction is invisible to the user except for a brief indicator
4. Original messages remain visible in the UI after compaction
5. Tool traces are efficiently compacted (>90% size reduction)
6. No loss of recent context or active task state during compaction
7. File cache invalidation on writes during waggle sessions
