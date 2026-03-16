# 61 — LLM-Based Consensus Detection

**Status:** Not Started
**Priority:** P2
**Category:** Waggle / Agent Behaviour
**Depends on:** None
**Enables:** More reliable waggle early termination, fewer wasted turns

---

## Problem

The current `checkConsensus()` in `src/main/agent/consensus-detector.ts` is a **pure heuristic** with no LLM involvement. It checks for:

1. Explicit agreement phrases ("I agree", "LGTM", "ship it", etc.)
2. Jaccard sentence similarity between the last two messages
3. Shrinking response length
4. Proximity to turn limit

This approach has significant failure modes:

- **False negatives (most common):** Analytical agents discussing code architecture rarely say "LGTM" or "I agree". Two agents can reach genuine agreement while still producing long, substantive responses — the heuristic misses this entirely and burns all remaining turns.
- **False positives:** An agent that starts a message with "I agree with the general direction, however..." gets flagged as agreement despite significant disagreement following.
- **Content similarity fails for code:** Two agents may produce nearly identical tool call sequences (reading the same files) while reaching opposite conclusions. Jaccard similarity on prose sentences doesn't work for code-heavy responses.
- **No understanding of semantics:** "The function should be pure" and "I think we should keep the function free of side effects" are semantically equivalent — the heuristic scores zero similarity.

From Diego's test run: 5 turns completed, `consensusReason: undefined` — the heuristic never triggered despite both agents converging on the same codebase analysis.

---

## Design

### Approach: LLM judge on detected convergence candidates

Rather than replacing the heuristic entirely, use it as a **cheap pre-filter** and only invoke the LLM when the heuristic signals possible convergence.

```
Each turn:
  1. Run existing heuristic (cheap, O(n) text scan)
  2. If heuristic confidence > LOW_THRESHOLD (e.g. 0.4):
     → Invoke LLM judge with last two turns + original question
     → Use judge's verdict as final decision
  3. If heuristic confidence <= LOW_THRESHOLD:
     → No LLM call, consensus not reached
```

This keeps the common case (clear non-consensus) essentially free, while getting accurate judgment when it matters.

### LLM Judge Design

**Input:** Original user question + last two agent turns
**Output:** `{ reached: boolean, confidence: number, reason: string }`
**Model:** Same as Agent A's model (already in context, no new provider needed)
**Prompt style:** Structured JSON output, temperature 0

The judge is NOT a new agent turn — it does not stream to the UI and uses no tools. It's a single non-streaming API call with a tight token budget (~500 tokens response max).

**Judge prompt structure:**
```
You are evaluating whether two AI agents have reached consensus on a task.

## Original Question
{userQuestion}

## Agent A's Last Response (Turn N)
{agentAText}

## Agent B's Last Response (Turn N+1)
{agentBText}

## Task
Determine if these agents have genuinely converged on the same answer, approach,
or conclusion — even if they express it differently.

Respond with JSON only:
{
  "reached": true | false,
  "confidence": 0.0–1.0,
  "reason": "one sentence explanation"
}

Rules:
- "reached: true" requires substantive agreement on the core question, not just politeness
- Partial agreement or agreement on minor points does not count
- If one agent is deferring to the other without engaging the substance, that is NOT consensus
- High confidence (>0.8) requires clear, explicit convergence on the main question
```

### Fallback

If the LLM judge call fails (timeout, API error, parse error):
- Log the failure
- Fall back to heuristic result
- Do NOT crash or halt waggle

---

## Implementation

### Phase 1: LLM Judge Function

- [ ] Create `src/main/agent/consensus-judge.ts`:
  - `checkConsensusWithLLM(params: ConsensusJudgeParams): Promise<WaggleConsensusCheckResult>`
  - `ConsensusJudgeParams`: `{ userQuestion: string, agentAText: string, agentBText: string, model: SupportedModelId, settings: Settings, signal: AbortSignal }`
  - Makes a single non-streaming `chat()` call (no tools, no agent loop, no IPC streaming)
  - Parses JSON response with Effect Schema validation
  - Returns `WaggleConsensusCheckResult` matching existing shape
  - Handles all failure modes: network error, parse error, invalid JSON → returns `{ reached: false, confidence: 0, reason: 'Judge unavailable' }`

### Phase 2: Heuristic Pre-filter Integration

- [ ] Add `LOW_HEURISTIC_THRESHOLD = 0.4` to `consensus-detector.ts`
- [ ] Export `checkConsensusHeuristicOnly()` (current `checkConsensus()` renamed)
- [ ] Create new `checkConsensus()` that:
  1. Calls `checkConsensusHeuristicOnly()`
  2. If `confidence >= LOW_HEURISTIC_THRESHOLD` → calls LLM judge
  3. Otherwise → returns heuristic result directly
  - This is async (LLM call), so signature becomes `Promise<WaggleConsensusCheckResult>`

### Phase 3: Wire into waggle-coordinator

- [ ] Update `runWaggleSequential()` in `waggle-coordinator.ts`:
  - `checkConsensus()` call becomes `await checkConsensus(...)`
  - Pass `userQuestion: payload.text` (already available)
  - Pass `model: agents[0].model` (Agent A's model for judge)
  - Pass `settings` and `signal` (already in scope)

### Phase 4: Cleanup

- [ ] Update `src/main/agent/__tests__/consensus-detector.unit.test.ts`:
  - Rename tests to reflect `checkConsensusHeuristicOnly`
  - Add unit tests for `checkConsensus` (new async version) with mocked LLM judge
  - Test fallback path when judge throws
- [ ] Add `src/main/agent/__tests__/consensus-judge.unit.test.ts`:
  - Mock `chat()` to return valid JSON → verify result shape
  - Mock `chat()` to return invalid JSON → verify fallback
  - Mock `chat()` to throw → verify fallback

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/main/agent/consensus-judge.ts` | LLM judge implementation |
| `src/main/agent/__tests__/consensus-judge.unit.test.ts` | Unit tests |

## Files to Modify

| File | Change |
|------|--------|
| `src/main/agent/consensus-detector.ts` | Rename existing fn, add async wrapper with LLM gate |
| `src/main/agent/__tests__/consensus-detector.unit.test.ts` | Update test names + add async tests |
| `src/main/agent/waggle-coordinator.ts` | `await checkConsensus(...)`, pass question + model |

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| LLM judge adds latency to each turn | Medium | Only called when heuristic confidence > 0.4; single fast call (~1s) |
| Judge API cost | Low | Only fires on convergence candidates, not every turn; tight token budget |
| Judge model unavailable (rate limit) | Low | Full fallback to heuristic on any error |
| Judge prompt injection via agent output | Low | Output is sandboxed in a JSON schema; we don't act on free-text in the response |
| Async signature change breaks tests | Medium | Rename existing function, keep both callable; update coordinator call site |

## Definition of Done

1. Waggle stops early when two agents genuinely agree on analytical/code questions
2. `consensusReason` is populated with a human-readable explanation
3. Heuristic-only path unchanged for non-convergence cases (no extra latency)
4. LLM judge failure does not crash waggle — falls back gracefully
5. All unit tests pass
6. `pnpm check:fast` clean
