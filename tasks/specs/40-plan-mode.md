# 40 — Plan Mode

**Status:** In Progress
**Priority:** P3
**Category:** Feature
**Depends on:** None
**Origin:** Waggle conversation review — Command Palette has "Plan mode" entry (line 144-151 of CommandPalette.tsx) that is a no-op. CLAUDE.md mandates "Plan Mode Default" workflow but the product has no runtime concept of it.

---

## Problem

The repository's own workflow rules (CLAUDE.md "Workflow Orchestration" section) mandate:

> "Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)"

But **the product has no concept of plan mode**. There is:
- A command palette entry "Plan mode" (line 144-151 of `CommandPalette.tsx`) that does nothing
- No UI state representing "plan mode is active"
- No IPC channel to toggle or query plan mode
- No behavioral change in the agent when plan mode is on/off
- No persistence of plan mode state

This is a **compliance gap**: the repo tells agents to use plan mode, but provides no mechanism for users or agents to activate, see, or enforce it.

### What Plan Mode Should Mean

When plan mode is active:
1. **Agent behavior changes**: The agent drafts a plan before writing code. It presents the plan to the user for approval before executing.
2. **UI shows plan state**: Clear indicator that the agent will plan before acting
3. **User can toggle**: Plan mode on/off via command palette, composer toggle, or settings
4. **Per-conversation**: Plan mode is a property of the current conversation, not global

### Reference: How other tools do this

| Tool | Plan Mode Concept |
|------|-------------------|
| Claude Code | `/plan` command — agent outlines steps, user approves, then executes |
| Cursor | "Thinking" mode — shows reasoning before generating code |
| Devin | Task planning step — visual plan with sub-tasks |
| Aider | Architect mode — one model plans, another executes |

## Implementation

### Phase 1: Core plan mode state

- [ ] Add `planMode: boolean` to `Conversation` type or conversation metadata
- [ ] Add IPC channels:
  - `'conversation:set-plan-mode'` — toggle per conversation
  - Plan mode state should be persisted with the conversation
- [ ] Add `planMode` to renderer conversation state (chat store or ui store)

### Phase 2: Agent behavior integration

- [ ] When `planMode === true`, inject a system prompt modifier:
  ```
  PLAN MODE IS ACTIVE. Before making any code changes:
  1. Analyze the request and identify all files that need to change
  2. Present a numbered plan with specific changes for each file
  3. Wait for user approval before executing any changes
  4. After approval, execute the plan step by step
  Do NOT write or edit files until the user explicitly approves your plan.
  ```
- [ ] This integrates with `src/main/agent/system-prompt.ts` or `prompt-pipeline.ts`
- [ ] The agent loop doesn't need structural changes — the system prompt drives behavior

### Phase 3: UI integration

- [ ] **Composer toggle**: Small toggle button or icon next to the send button
  - When active: shows "Plan" badge, send button says "Send (Plan)"
  - When inactive: normal send behavior
- [ ] **Command palette**: Wire the existing "Plan mode" entry to toggle `planMode`
  - Show current state: "Plan mode: ON" / "Plan mode: OFF"
- [ ] **Conversation header**: Subtle indicator when plan mode is active
  - Badge or icon: "Planning mode active"
- [ ] **Plan approval UI**: When the agent presents a plan:
  - Render plan steps as a checklist
  - "Approve" button to let the agent proceed
  - "Edit" to let the user modify the plan before approval
  - "Cancel" to discard the plan

### Phase 4: Smart plan mode (optional)

- [ ] Auto-suggest plan mode for complex requests
  - Heuristic: message length > 200 chars, or contains keywords like "refactor", "migrate", "restructure"
  - Show: "This looks like a complex task. Enable plan mode? [Yes] [No]"
- [ ] Auto-detect plan output from agent and render it as structured plan
  - Parse numbered lists or markdown checklists from agent response
  - Offer "Approve and execute" even when plan mode wasn't explicitly active

## Files to Create

- `src/renderer/src/components/composer/PlanModeToggle.tsx` — toggle button in composer
- `src/renderer/src/components/chat/PlanApproval.tsx` — plan review/approve UI

## Files to Modify

- `src/shared/types/conversation.ts` — add `planMode` to conversation metadata
- `src/main/agent/system-prompt.ts` or `prompt-pipeline.ts` — plan mode system prompt injection
- `src/renderer/src/components/command-palette/CommandPalette.tsx` — wire plan-mode command (line 144-151)
- `src/renderer/src/components/composer/Composer.tsx` — plan mode toggle + send behavior
- `src/renderer/src/components/chat/ChatPanel.tsx` — plan mode indicator
- `src/main/store/conversations.ts` — persist plan mode state
- `src/shared/types/ipc.ts` — plan mode IPC channels

## Tests

- Unit: plan mode system prompt injected when active
- Unit: plan mode persists across conversation reload
- Component: toggle button shows correct state
- Component: plan approval UI renders for plan-formatted responses
- Integration: agent produces plan instead of immediately writing code when plan mode active

## Review Notes (2026-03-06, spec/code audit)

- Plan mode is no longer just a concept in repo docs: the composer has a real toggle, payloads carry `planModeRequested`, the prompt pipeline injects plan-mode instructions, and the `proposePlan` tool plus approval UI (`PlanCard`) are implemented end to end.
- The main remaining gaps are product-polish and persistence: the command-palette entry is still a no-op, the toggle is composer-scoped rather than conversation-persisted, and the spec's per-conversation storage/indicator requirements are not yet met.
