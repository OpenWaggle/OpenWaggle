# 32 — Cross-Agent Review Loop

**Status:** Planned
**Priority:** P3
**Category:** Feature
**Depends on:** Waggle Conversation (done)
**Origin:** Spec 15

---

## Goal

Agent A generates code, Agent B reviews it with a different model and criteria, they negotiate changes, and the user sees a converged, reviewed result. The first coding tool where AI-generated code is automatically reviewed by a second AI before being presented.

### Research Support

- **CriticGPT** (OpenAI): LLM critics caught 85% of bugs vs 25% by humans
- **AgentCoder**: Waggle achieved 96.3% pass@1 on HumanEval vs 90.2% single-model
- **Model diversity**: 78% fewer bugs when using diverse AI tools vs single-model

## Architecture

```
User sends task
  → Generator (Model A) produces code
  → Reviewer (Model B) critiques with structured feedback
  → If material issues:
    → Generator revises addressing each issue
    → Reviewer re-checks (max 3 rounds)
  → Present final code + review summary to user
```

## Implementation

### Phase 1: Review Loop Core
- [ ] `src/main/agent/review-loop.ts` — Generator → Reviewer → Generator cycle
- [ ] `src/shared/types/review.ts` — ReviewLoopConfig, ReviewIssue, ReviewSummary
- [ ] Reviewer system prompt with severity calibration

### Phase 2: Review UI
- [ ] Progressive disclosure: code with review annotations
- [ ] Color-coded by severity (critical/high/medium/low)
- [ ] "Resolved" / "Unresolved" badges per issue

### Phase 3: User Controls
- [ ] Review mode selector: Off / Quick / Standard / Thorough
- [ ] Skip review button mid-loop
- [ ] Cost transparency

### Phase 4: Smart Defaults
- [ ] Auto-suggest review for security-sensitive paths and large changes

## Token Cost Analysis

| Depth | Generator | Reviewer | Rounds | Overhead |
|-------|-----------|----------|--------|----------|
| Quick | Sonnet | Haiku | 1 | ~20% |
| Standard | Sonnet | Sonnet | 2 | ~60% |
| Thorough | Sonnet | Opus | 3 | ~120% |

## Files to Create

- `src/main/agent/review-loop.ts`
- `src/shared/types/review.ts`
- `src/renderer/src/components/chat/ReviewPanel.tsx`
- `src/renderer/src/components/composer/ReviewModeSelector.tsx`

## Files to Modify

- `src/main/ipc/agent-handler.ts`
- `src/shared/types/ipc.ts`
- `src/renderer/src/components/chat/MessageBubble.tsx`
- `src/renderer/src/stores/chat-store.ts`
