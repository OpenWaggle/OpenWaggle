# Spec 15 — Cross-Agent Review Loop

**Goal**: Agent A generates code, Agent B reviews it with a different model and criteria, they negotiate changes, and the user sees a converged, reviewed result. The first coding tool where AI-generated code is automatically reviewed by a second AI before being presented.

**Status**: Planned

**Depends on**: Spec 00 (Multi-Agent Conversation) — the review loop builds on the multi-agent coordinator infrastructure

---

## The Gap

| Tool | What It Does | What's Missing |
|------|-------------|---------------|
| CodeRabbit | Reviews human-authored PRs | Doesn't review AI-generated code; no generation loop |
| Qodo 2.0 | 15+ review agents + judge | Reviews human code, not AI output; no negotiation |
| Aider Architect/Editor | Two models (plan + execute) | Sequential decomposition, not review/critique |
| Devin | Orchestrator + subagents | Task decomposition, not adversarial review |
| Amazon Q Developer | Reviews AI-generated code | Single-model, single-pass, no negotiation |
| GitHub Copilot | Separate coding + review agents | Don't form a closed loop |

**The novel pattern**: Generate (Model A) → Review (Model B, different criteria) → Negotiate → Converge → Present to user.

### Research Support

- **CriticGPT** (OpenAI): LLM critics caught **85% of bugs** vs **25% by humans**. Human+CriticGPT team preferred in 63% of cases.
- **AgentCoder**: Multi-agent (programmer + test designer + executor) achieved **96.3% pass@1** on HumanEval vs 90.2% single-model SOTA.
- **Model diversity**: Studies show **78% fewer bugs** when using diverse AI tools vs single-model.
- **Key insight**: Using the *same* model for generation and review creates an echo chamber. Different models catch different issues.

---

## Architecture

### Review Loop Flow

```
User sends task
  → Generator (Model A) produces code
  → Code presented to Reviewer (Model B)
  → Reviewer critiques with structured feedback:
    { issues: [{ severity, category, description, suggestion }] }
  → If material issues:
    → Generator receives critique + original code
    → Generator revises addressing each issue
    → Reviewer re-checks (max 3 rounds)
  → If no material issues or max rounds:
    → Present final code + review summary to user
```

### Review Criteria Categories

| Category | Priority | What It Catches |
|----------|----------|----------------|
| Correctness | Critical | Logic errors, edge cases, off-by-one |
| Security | Critical | Injection, XSS, secrets exposure |
| Test coverage | High | Missing tests, untested paths |
| Architecture | Medium | Cross-file impact, pattern violations |
| Performance | Medium | N+1 queries, unnecessary re-renders |
| Style/conventions | Low | Project-specific patterns |

### Convergence Criteria

1. **No material issues**: Reviewer approves (most common, rounds 1-2)
2. **Max rounds reached**: Hard stop at 3 rounds, present with unresolved items
3. **Diminishing returns**: Round N critique is purely stylistic after round N-1 addressed correctness
4. **User interrupt**: User accepts current state at any time

---

## Implementation

### Phase 1: Review Loop Core

- [ ] Create `src/main/agent/review-loop.ts`
  - `runReviewLoop(params: ReviewLoopParams): AsyncIterable<ReviewLoopEvent>`
  - Orchestrates Generator → Reviewer → Generator cycle
  - Builds on multi-agent coordinator from Spec 00
  - Each round: generator's output is fed as context to reviewer, reviewer's critique fed back to generator
  - Convergence detection: parse reviewer response for issue count, severity
- [ ] Create `src/shared/types/review.ts`
  - `ReviewLoopConfig`: generator model, reviewer model, max rounds, criteria focus, auto-apply
  - `ReviewIssue`: severity (critical/high/medium/low), category, description, file, line range, suggestion
  - `ReviewRound`: round number, issues found, issues resolved, generator response
  - `ReviewSummary`: total rounds, issues found, issues resolved, final verdict
- [ ] Define reviewer system prompt
  - Role: "You are a code reviewer. Your job is to critique, not to generate."
  - Criteria-specific: security focus, correctness focus, full review
  - Structured output: require issues as structured list, not prose
  - Severity calibration: "Only flag issues that would fail a code review. Skip style nits unless they cause bugs."

### Phase 2: Review UI

- [ ] Progressive disclosure presentation
  - Show generated code immediately (tentative state)
  - Review annotations appear as code completes
  - Each annotation expandable to show reviewer's reasoning
  - Top-level summary: "Review: 3 issues found, 3 resolved"
- [ ] Review panel in message bubble
  - Collapsible "Review Thread" showing back-and-forth
  - Color-coded by severity (red = critical, orange = high, yellow = medium)
  - "Resolved" / "Unresolved" badges per issue
- [ ] Real-time progress indicator
  - "Generating... → Reviewing... → 2 issues found, revising... → Done"
  - Compact status bar during review loop

### Phase 3: User Controls

- [ ] Review mode selector in composer
  - Off (default for quick iterations)
  - Quick review (1 pass, cheaper model)
  - Standard review (2 passes)
  - Thorough review (3 passes, expensive model)
- [ ] Skip review button (mid-loop)
  - "Accept current code without further review"
- [ ] Reviewer model selection
  - Default: complementary model to generator (e.g., generate with Sonnet, review with Opus)
  - User can override in settings
- [ ] Review criteria focus
  - Security-only, correctness-only, full (default)
  - Per-project defaults via `.openwaggle/review-config.json`
- [ ] Cost transparency
  - Show estimated additional token cost before review starts
  - Running cost counter during review

### Phase 4: Smart Defaults

- [ ] Auto-detect when review is valuable
  - Security-sensitive paths (auth, payments, crypto) → auto-suggest review
  - Large code changes (> 100 lines) → suggest review
  - New file creation → suggest review (new code = more risk)
  - Quick edits / small fixes → skip review by default
- [ ] Review presets
  - "Security Audit": reviewer focuses on OWASP top 10
  - "Code Quality": style, patterns, conventions
  - "Architecture Review": cross-file impact, dependency analysis

### Phase 5: Integration with PR Workflow

- [ ] Attach review summary to generated code blocks
  - "This code was reviewed by [reviewer model]: 3 issues addressed"
- [ ] Export review as structured data
  - For inclusion in PR descriptions or commit messages
  - Integrates with existing commit workflow

---

## Token Cost Analysis

A two-pass review adds roughly **40-80% token overhead** vs single-pass generation.

**Cost mitigation strategies:**
1. Use a cheaper model for reviewer (Haiku for review, Sonnet for generation)
2. Send only the diff + surrounding context to reviewer, not full conversation
3. Cap at 3 rounds
4. Let users choose review depth

**Example costs per review loop (rough estimates):**
| Review Depth | Generator | Reviewer | Rounds | Overhead |
|-------------|-----------|----------|--------|----------|
| Quick | Sonnet | Haiku | 1 | ~20% |
| Standard | Sonnet | Sonnet | 2 | ~60% |
| Thorough | Sonnet | Opus | 3 | ~120% |

---

## Files to Create

- `src/main/agent/review-loop.ts` — review orchestration
- `src/shared/types/review.ts` — review types and config
- `src/renderer/src/components/chat/ReviewPanel.tsx` — review annotations UI
- `src/renderer/src/components/composer/ReviewModeSelector.tsx` — review depth selector

## Files to Modify

- `src/main/ipc/agent-handler.ts` — handle review-enabled requests
- `src/shared/types/ipc.ts` — review-related IPC channels
- `src/renderer/src/components/chat/MessageBubble.tsx` — review annotations
- `src/renderer/src/stores/chat-store.ts` — review state tracking
- `src/renderer/src/stores/settings-store.ts` — review defaults

---

## Relationship to Spec 00 (Multi-Agent)

The review loop is a *specialized* multi-agent conversation:
- Spec 00 provides the general coordinator infrastructure (sequential turn-taking, agent identity, IPC)
- Spec 15 builds a specific workflow on top: structured review with criteria, convergence, and annotations
- The review loop uses the same `runAgent()` calls, same stream infrastructure, same IPC channels
- Difference: Spec 00 is freeform collaboration, Spec 15 is structured review with a defined protocol

---

## Verification

- [ ] Generator produces code, reviewer finds issues, generator revises (end-to-end loop)
- [ ] Review annotations appear inline in the UI with severity indicators
- [ ] Max rounds cap prevents infinite loops
- [ ] User can skip review mid-loop
- [ ] Different reviewer models produce different critique (model diversity works)
- [ ] Review summary is attached to final code presentation
- [ ] Token cost is visible to user during review
- [ ] Quick review (1 pass, cheap model) completes in < 30 seconds additional time
