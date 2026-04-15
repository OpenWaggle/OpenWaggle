# Context UX Product Spec

## Status

Draft product specification for issue #43 context compaction and context-awareness UX.

## Purpose

Define the product behavior, user experience, and implementation guardrails for OpenWaggle's context-management experience.

This spec covers:
- context visibility in the composer
- context inspection and management
- automatic and manual compaction
- pinned context
- model-switch safety
- waggle-aware context budgeting
- chat-visible context events

This spec is intentionally product-first, but detailed enough to guide implementation on `feat/43-context-compaction`.

---

# 1. Product Promise

OpenWaggle should provide **trustworthy continuity, powered by transparency and control**.

Users should feel confident that long-running AI-assisted coding sessions will not silently degrade, unexpectedly forget important information, or allow dangerous model switches without warning.

Transparency means users can see:
- how full the current context is
- what changed
- what compaction did
- which model constraints apply

Control means users can:
- manually compact a thread
- provide compaction instructions
- save thread-level compaction guidance
- pin important context so it receives highest preservation priority

The combined outcome is **trustworthy continuity**: long conversations remain understandable, steerable, and safe.

---

# 2. Problem Statement

Long-running OpenWaggle conversations currently suffer from a context-management trust gap.

Users do not have a strong mental model for:
- how full the current context window is
- when compaction may happen
- what was preserved vs summarized
- how model switching affects context capacity
- how waggle mode changes the effective safe budget

Even if backend compaction is technically correct, the UX still fails if users feel surprised, fragile, or unable to protect what matters.

This spec addresses both sides of the problem:
1. **Context correctness** — the app must manage context windows safely.
2. **Context legibility** — the app must make that behavior visible and understandable.

---

# 3. Goals

## 3.1 Primary goals

1. Make context a continuously visible runtime resource.
2. Let users inspect and understand the current memory situation.
3. Make compaction visible, explainable, and user-steerable.
4. Prevent dangerous or impossible model switches based on current thread context.
5. Let users protect important information with pinned context.
6. Preserve a single coherent mental model across normal chat and waggle mode.

## 3.2 Secondary goals

1. Keep the UI compact and integrated into the existing composer/chat shell.
2. Prefer simple, understandable interactions over overly clever heuristics.
3. Avoid popups, toasts, or disruptive interruptions for normal compaction feedback.
4. Keep product terminology human and operational rather than deeply technical.

---

# 4. Non-Goals

This spec does **not** require in v1:
- full reversible compaction / undo
- pinning arbitrary repo artifacts as first-class memory objects
- a separate waggle-only context product surface
- exposing raw internal threshold percentages and safety-margin numbers in the UI
- multiple simultaneously open side panels
- a full audit-log experience for every compaction ever performed in the thread

---

# 5. Core UX Principles

## 5.1 Context is a resource, not a hidden backend detail
Users should always be able to perceive context health near the point of interaction.

## 5.2 Chat is the source of narrative truth
If compaction materially changes thread memory, that event should be visible in the chat timeline.

## 5.3 The inspector is for explanation and management
Detailed state, model compatibility, pinning, and compaction history belong in a dedicated Context Inspector.

## 5.4 Model switching is also memory switching
A model change is not just a preference change. It changes the size of the memory container and must be treated accordingly.

## 5.5 Pins are strong priorities, not infinite memory
Pinned items receive highest preservation priority, but the UI must remain honest if they are eventually summarized under extreme pressure.

## 5.6 Waggle should stay conceptually unified
Waggle context should not feel like a completely separate memory system, but the UI must surface when the smallest participating model governs the effective safe budget.

## 5.7 KISS where possible
Prefer simple, durable patterns over overengineered flows. Complexity is acceptable only where it materially improves trust or control.

---

# 6. Information Model

## 6.1 Canonical context snapshot
The canonical context snapshot must live in the **main process**.

The renderer may add presentation-only state, but it must not invent or derive the canonical truth independently.

### Canonical snapshot includes
- effective prompt payload usage
- current model context window
- pinned-context contribution as a separate breakdown
- thread-level compaction status and metrics
- current waggle governing budget when applicable

### Renderer-only presentation state may include
- panel open/closed state
- section expansion state
- hover/focus state
- transient visual animation state
- brief “just compacted” emphasis

## 6.2 What “context” means in the product
The primary meter and top overview must be grounded in the **actual effective prompt payload**.

Pinned context should be shown as a **secondary breakdown** of that effective payload.

Other concepts such as summarized history or reloadable context should be explained in the inspector, but should not be conflated with the live prompt budget.

---

# 7. Composer Context Meter

## 7.1 Placement
Replace the currently unused icon in the composer chrome with a new **dynamic radial context meter**.

This is the primary context-awareness entry point.

It should live in the exact composer utility area identified by the user, adjacent to the existing composer controls and branch label region.

## 7.2 Purpose
The composer meter must provide:
- continuous visibility into context pressure
- a compact, glanceable status surface
- an entry point into the Context Inspector

## 7.3 Visual behavior
The composer control must be:
- circular
- dynamically filled according to actual current usage
- never a fixed static icon
- percentage/value displayed inside the circle

Behavior:
- if context usage is 10%, the radial fill shows 10%
- if context usage is 62%, the radial fill shows 62%
- low usage remains strictly proportional; no artificial minimum arc

## 7.4 Interaction
On click, the meter opens the **Context Inspector** in the shared right-side panel shell.

## 7.5 Compaction behavior
### Preferred behavior
During active compaction, if truthful intermediate usage updates are available, the meter should visibly reduce its filled area as context usage drops.

### Fallback behavior
If intermediate updates are not available, keep the same meter and apply a plain active state, then snap to the final true value on completion.

## 7.6 Post-compaction behavior
After compaction completes, the meter may briefly acknowledge the state change, then must quickly return to its normal usage display.

## 7.7 Unknown-state policy
“Unknown context usage” is not a normal UX state.

The product expectation is that enabled models and active threads always have a valid context snapshot. If that is ever not true, it should be treated as an implementation bug, not a designed fallback mode.

---

# 8. Shared Right-Side Inspector Shell

## 8.1 Shell behavior
OpenWaggle should use a **single shared right-side inspector shell**.

Only one inspector is active at a time.

If another panel is already open and the user clicks the context meter, the current panel is replaced with the Context Inspector.

## 8.2 Quick switching
The app header should provide quick-access controls for switching between major inspectors such as:
- Context
- Diff
- other future inspector surfaces

This ensures users have two fast entry points:
1. the composer context meter
2. header quick-switch controls

## 8.3 Avoided behavior
Do not stack multiple drawers or allow competing overlapping side panels as the primary v1 behavior.

---

# 9. Context Inspector

## 9.1 Purpose
The Context Inspector is the primary place to:
- understand current context health
- inspect memory structure
- manage pinned context
- run manual compaction
- understand model-switch compatibility
- review recent compaction history
- understand waggle-specific context constraints

## 9.2 Layout
The inspector should be organized as:
- **top overview**
- followed by **expandable sections**

This should not be a pure long-scroll dump or a full tabbed mini-app.

---

# 10. Context Inspector Overview

## 10.1 Overview purpose
The top overview acts as a control tower. It must provide immediate understanding before the user opens any deeper section.

## 10.2 Required overview contents
The overview must include:
- current context usage
- current model
- current context health state
- primary actions
- last significant context event
- pinned-context contribution as a secondary breakdown

## 10.3 Metric hierarchy
### Primary metric
- effective context usage versus current model context window

### Secondary metric
- pinned-context portion of that effective usage

Pinned context should not visually compete equally with the total. It should be presented as a meaningful secondary breakdown.

## 10.4 Primary actions in overview
The overview must include these actions:
- **Compact now**
- **Add pinned instruction**
- **Manage pins**

## 10.5 Last event summary
The overview should show the latest meaningful context event, such as:
- last compaction summary
- recent major memory-affecting state change

Example style:
- `Last compacted 8 min ago · 23 messages · 412k → 126k`

---

# 11. In-Chat Compaction Events

## 11.1 Visibility rule
Compaction should be visible **in the chat timeline**, not through popups or intrusive global notifications.

## 11.2 Event types
Both of the following must create lightweight visible chat events:
- automatic compaction
- manual compaction

## 11.3 Default event content
Compaction events should combine:
- what happened
- how much was summarized
- before/after token impact

Example format:
- `Context compacted — summarized 23 messages · 412k → 126k tokens`

Manual compaction should be labeled distinctly, for example:
- `Context compacted manually — summarized 18 messages · 310k → 104k tokens`

## 11.4 Event detail scope
The chat event should stay outcome-oriented.

Detailed instruction text used for manual compaction should remain in the Context Inspector, not in the main timeline.

---

# 12. Automatic Compaction

## 12.1 Trigger model
Automatic compaction should use:
- a threshold
- plus a reserved safety margin

This ensures the system compacts before the thread reaches a risky boundary.

## 12.2 User-facing explanation
The inspector should explain this in human terms, for example:
- OpenWaggle keeps headroom so replies and tool output still fit.

Do not expose raw internal threshold numbers as a required primary UI element.

## 12.3 Visibility
Automatic compaction should never be fully silent. It must be visible in the chat timeline and reflected in the Context Inspector.

---

# 13. Manual Compaction

## 13.1 Purpose
Users must be able to compact a conversation intentionally, not only reactively.

Typical reasons include:
- cleaning up a long thread
- preserving particular priorities
- preparing for a smaller-window model switch
- reducing clutter before continuing work

## 13.2 Manual compaction entry points
Users must be able to manually compact via:
1. **Context Inspector**
2. **Composer slash command**

## 13.3 Inspector actions
The inspector should distinguish clearly between:
- **Compact now**
- **Compact with instructions**

## 13.4 Compact now
Runs a manual compaction immediately using the default policy.

## 13.5 Compact with instructions
This should redirect into the composer as the canonical advanced path.

Behavior:
- focus the composer
- prefill `/compact `
- show command-specific helper guidance in the slash-command UI

---

# 14. `/compact` Composer Command

## 14.1 Command role
`/compact` is a first-class control command, not normal conversational content.

## 14.2 Timeline behavior
Running `/compact` or `/compact <instructions>` should **not** create a normal user message bubble.

Instead, the command executes as a control action and the resulting compaction outcome appears as a visible in-chat compaction event.

## 14.3 Guidance UX
Guidance for `/compact` should be built into the slash-command help/autocomplete UI.

This UI should support:
- example instruction patterns
- optional save-for-thread behavior
- future validation and discoverability

## 14.4 Save for thread
The `/compact` command flow should support an optional UI control/toggle to save the compaction instruction as **thread-level compaction guidance**.

This must be done through command UI controls, not syntax-heavy inline flags.

---

# 15. Compaction Instructions

## 15.1 Instruction modes
Compaction instructions must support:
- **one-time guidance**
- **optional persistent thread-level guidance**

## 15.2 Thread-level guidance persistence
Thread-level compaction guidance should remain unchanged across model switches in v1.

The guidance is part of the conversation’s intent and should not be silently reset.

---

# 16. Pinned Context

## 16.1 Goal
Pinned context lets users protect important information from being lost during compaction.

## 16.2 Pinned context types in v1
Pinned context must support:
- pinned instructions
- pinned selected thread content

### Pinnable thread content includes
- user messages
- assistant messages
- compaction summaries/events

## 16.3 Pinning interactions
Thread content should be pinnable via:
- hover quick action
- overflow menu fallback

## 16.4 Visibility and management
Pinned state should be visible in the thread.

The Context Inspector is the main place to review and manage all pinned items.

## 16.5 Preservation contract
Pinned items receive **highest preservation priority**.

However, pinned items are not guaranteed infinite verbatim preservation. If context pressure becomes extreme, they may be summarized as a last resort.

## 16.6 Summarized pinned items
If a pinned item is no longer preserved verbatim and becomes summarized:
- that state change must be visible in the thread
- that state change must also be explained in the Context Inspector

This should read as “still important, but no longer verbatim.”

---

# 17. Model-Switch Safety

## 17.1 Product principle
Switching models is also switching memory capacity.

The UI must make users aware that context windows differ substantially across models.

## 17.2 Model context visibility
The user should be able to see all enabled models and their context windows so they understand switch risk.

Examples:
- `Claude Opus · 1M`
- `GPT-5.4 · 200k`

## 17.3 Where this appears
Model context awareness should appear in:
- the model selector/dropdown
- the Context Inspector

## 17.4 Inspector model list
The Context Inspector should show:
- current model
- all enabled models
- each model’s context window
- compatibility/risk status relative to the current thread

Status examples:
- comfortable
- tight fit
- would require compaction
- blocked

## 17.5 Actionability
The inspector’s model list should be **status-first and actionable where valid**.

Allowed interactions:
- safe switches can be initiated directly
- risky but valid switches require confirmation
- invalid switches remain disabled with explanation

## 17.6 Risky switches
If the switch is risky but still possible, require confirmation.

## 17.7 Impossible switches
If current thread context already exceeds the target model’s context window, do not allow the switch.

Disabled state should explain why, such as:
- `This conversation exceeds this model's context window.`
- `Compact the conversation first to use this model.`

---

# 18. Waggle Context

## 18.1 Conceptual model
Waggle context should remain part of the same overall context model as normal chat.

## 18.2 Practical budgeting rule
When waggle is active, compaction should bias toward the **smallest participating context window**.

This smallest active model governs the effective safe budget.

## 18.3 Visibility
The UI must surface this in two places:
- top overview
- waggle-specific section inside the Context Inspector

## 18.4 Overview presentation
When waggle is active, the top overview should include a compact comparative display of active waggle models.

This should be shown as a **mini stacked list** including:
- model name
- context window
- clear governing indicator on the smallest model

## 18.5 Waggle section
The waggle section should explain in more detail:
- that multiple models are participating
- that the smallest active context window governs compaction behavior
- why compaction may happen sooner than the user expects from a larger participating model

---

# 19. Context Inspector Sections

The Context Inspector should use expandable sections below the overview.

## 19.1 Suggested required sections
1. **Pinned Context**
   - pinned instructions
   - pinned messages/events
   - status of any summarized pinned items

2. **Model Compatibility**
   - current model
   - enabled models
   - context windows
   - risk/blocked/safe statuses
   - switch affordances where valid

3. **Compaction History**
   - short recent history only
   - latest few compactions
   - automatic vs manual
   - messages summarized
   - before/after token impact
   - timestamp

4. **Memory Structure / Thread Context**
   - recent conversation
   - summarized history
   - reloadable context explanation
   - high-level mental model of what is currently active

5. **Waggle** (only when relevant)
   - active waggle model comparison
   - governing smallest-window model
   - waggle-specific context explanation

---

# 20. Compaction History

## 20.1 Scope
The inspector should show a **short recent history**, not just the latest event and not an infinite full audit log.

## 20.2 Entry data
Each entry should include as available:
- automatic or manual
- timestamp
- messages summarized
- before/after token usage
- instruction presence or policy context where appropriate

## 20.3 Undo
Compaction is a **forward-only** operation in v1.

There is no undo.

---

# 21. Empty / Pre-Compaction Inspector State

Even if no compaction has happened yet, the Context Inspector should be fully useful.

It should present a **proactive readiness view** including:
- current usage
- current model/window
- context health
- explanation of how OpenWaggle manages context
- manual compaction actions
- pinning entry points
- model-switch compatibility awareness

This inspector should not feel like a postmortem-only tool.

---

# 22. UX Copy Principles

## 22.1 Preferred tone
Use human, operational language.

Examples:
- `Context healthy`
- `Near limit`
- `Would require compaction`
- `Compact the conversation first to use this model`
- `OpenWaggle keeps headroom so replies and tool output still fit`

## 22.2 Avoid
Avoid overly internal, implementation-heavy phrasing in primary UI.

Examples to avoid as first-line UX copy:
- raw threshold percentages
- internal token-estimation caveats
- obscure transport/process details

Detailed numeric token metrics are fine where useful, but the first layer should remain understandable.

---

# 23. Behavioral Rules Summary

## 23.1 Musts
- The composer meter must always be dynamic, not static.
- Context changes must be visible in chat when compaction occurs.
- The Context Inspector must be the main management surface.
- Manual compaction must exist in both inspector and composer command flows.
- Pinned items must be visible and manageable.
- Model-switch safety must prevent impossible switches.
- Waggle must surface smallest-window governance.
- Main process must own canonical context truth.

## 23.2 Must nots
- Do not rely only on banner-style post-event feedback.
- Do not allow impossible model switches.
- Do not hide compaction entirely from the chat timeline.
- Do not treat pins as infinite magical memory.
- Do not fragment the UX across multiple competing side drawers.
- Do not treat “unknown context” as a normal steady-state UX.

---

# 24. Acceptance Criteria

The implementation should be considered product-complete when all of the following are true.

## 24.1 Composer awareness
- The unused composer icon has been replaced with a dynamic radial context meter.
- The meter reflects live context usage proportionally.
- The center content shows usage value/percentage.
- Clicking the meter opens the Context Inspector.

## 24.2 Inspector shell and navigation
- The Context Inspector opens in the shared right-side panel shell.
- Only one inspector is active at a time.
- Header quick-access controls allow fast switching between inspectors.

## 24.3 Overview
- The overview shows effective payload usage, current model, context health, pinned-context breakdown, actions, and last significant event.
- The overview supports `Compact now`, `Add pinned instruction`, and `Manage pins`.

## 24.4 Compaction visibility
- Automatic compaction creates a visible in-chat event.
- Manual compaction creates a visible in-chat event.
- The event includes both summarized-message count and before/after impact where available.

## 24.5 Manual compaction flows
- Manual compaction can be triggered from the inspector.
- `/compact` works as a control command, not a normal chat message.
- `/compact` guidance is integrated into slash-command UI.
- `/compact` supports save-for-thread behavior via command UI controls.

## 24.6 Pinned context
- Users can pin instructions.
- Users can pin user messages, assistant messages, and compaction summaries/events.
- Pinned items are manageable in the inspector.
- Pinned items visibly show their pinned state in the thread.
- If pinned items become summarized, both thread and inspector reflect that changed state.

## 24.7 Model-switch safety
- The model selector shows context-window information.
- The inspector shows all enabled models and their compatibility state.
- Risky valid switches require confirmation.
- Impossible switches are blocked with a clear explanation.

## 24.8 Waggle
- Waggle state appears in the Context Inspector when active.
- The smallest participating context window is surfaced as the governing effective budget.
- The overview presents active waggle models in a mini stacked list with the governing model highlighted.

## 24.9 Architecture
- Canonical context snapshot is produced in main.
- Renderer treats that snapshot as source of truth.
- Context accounting is based on effective payload with pinned-context breakdown.

---

# 25. Implementation Guardrails

## 25.1 Product guardrails
- Favor trust and legibility over cleverness.
- Never hide high-impact memory changes.
- Keep the main experience compact and integrated.

## 25.2 Architecture guardrails
- Main process owns canonical context accounting.
- Renderer adds presentation only.
- Shared cross-process types must live in shared type modules.

## 25.3 UX guardrails
- No popup-heavy compaction UX.
- No static icon placeholder for context state.
- No model-switch UI that omits context-window consequences.
- No separate waggle-only context product unless future evidence demands it.

---

# 26. Future Extensions

These are explicitly out of immediate v1 scope but fit the direction of this spec:
- deeper inspectability of summarized contents
- richer pin prioritization controls
- repo-artifact pinning with clear freshness semantics
- more advanced waggle memory breakdowns
- policy tuning UI for expert users
- richer comparative forecasting for model switches

---

# 27. Final Summary

This spec defines OpenWaggle context UX as a visible, manageable system rather than an invisible backend safeguard.

The user should always be able to:
- see how full context is
- understand what memory means in the current thread
- manually compact when needed
- pin what matters most
- switch models safely and knowingly
- understand waggle-specific context constraints

The intended result is not just successful compaction. It is **trustworthy continuity** across long-running AI coding sessions.