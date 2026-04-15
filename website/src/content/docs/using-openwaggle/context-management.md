---
title: "Context Management"
description: "Understand context usage, compact conversations, pin important messages, and switch models safely."
order: 5
section: "Using OpenWaggle"
---

Every AI model has a **context window** — a limit on how much information it can process at once. Your conversation history, system prompt, tool definitions, project instructions, and skills all consume context. OpenWaggle makes this visible and manageable.

![Context Inspector showing token usage, health status, and management actions](/screenshots/feature-context-inspector.png)

## Context Meter

The **radial gauge** in the bottom-right of the composer shows your current context usage as a percentage.

- **Green** — Healthy. Plenty of room.
- **Yellow** — Elevated. Getting fuller.
- **Red** — Near the limit or over.

The meter is always live. Even before you send a message, it reflects the baseline usage from the system prompt, tools, and connected MCP servers.

**Click the meter** to open the Context Inspector. Click again to close it.

## Context Inspector

The inspector is a right-side panel (same slot as the diff panel — only one is open at a time). You can also toggle it from the header icon.

### Overview

Shows token usage, health status, current model, pinned item count, and recent compaction info. Two action buttons:

- **Compact now** — Run compaction immediately
- **With instructions** — Prefills `/compact ` in the composer so you can add custom guidance

### Pinned Context

View and manage pinned messages and instructions with token cost estimates.

### Model Compatibility

Shows all enabled models with compatibility status relative to the current conversation. Click a model to switch — safe switches happen immediately, risky ones ask for confirmation, and blocked models explain why.

### Compaction History

Recent compaction events with timestamps and token impact.

### Waggle Context

When waggle mode is active, shows participating models and highlights the governing model (the smallest context window).

## How Compaction Works

### Automatic Compaction

OpenWaggle uses a three-layer approach to manage context:

**Tier 1 — Microcompaction** runs on every message. Old tool results (file reads, command outputs) are replaced with compact placeholders. The 5 most recent are kept intact. In typical coding sessions, tool results consume 60-80% of the context window — microcompaction strips the stale ones, resulting in roughly 20-60% context reduction depending on tool usage intensity.

**Tier 2 — Full compaction** triggers when the conversation reaches 90% of the model's context window. An LLM summarizes older messages into a handoff summary while preserving recent messages, the last assistant response, and pinned content.

**Reactive safety net** — if our estimate is slightly off and the provider rejects the request, OpenWaggle catches the error, compacts, and retries automatically. You see a brief delay but your message goes through.

### Manual Compaction

You can compact anytime without waiting for the automatic trigger.

**From the inspector:** Click **Compact now** or **With instructions**.

**From the composer:** Type `/compact` and send. Add instructions after the command:

```
/compact preserve the auth module analysis and the API design decisions
```

The `/compact` command does not create a chat message — it runs as a control action. The result appears as an inline compaction event in the chat timeline.

### Save for Thread

When typing `/compact` with instructions, a **Save for thread** toggle appears in the toolbar. When enabled, your instructions become permanent guidance for this conversation — every future compaction follows them.

Useful for long threads where certain context always matters:

```
/compact always preserve the migration plan and schema decisions
```

## Pinned Context

Pin important messages so they survive compaction.

### How to Pin

- **From chat** — Hover over any user or assistant message and click the pin icon
- **From the inspector** — Click **Add instruction** in the Pinned Context section

### Preservation

Pinned content gets the highest preservation priority. The compaction LLM is instructed to keep it verbatim. Under extreme pressure (>95% even after compaction), pinned content may be summarized as a last resort — when this happens, it's flagged in the timeline.

## Model-Switch Safety

Different models have different context windows (e.g., Claude Opus 4.6 has 1M tokens, GPT-5.4 has 272K). The composer dropdown shows context window sizes next to each model.

The inspector's **Model Compatibility** section shows status for every enabled model:

| Status | Meaning |
|--------|---------|
| Comfortable | Plenty of room |
| Tight fit | Fits but close |
| Would compact | Requires compaction (confirmation dialog) |
| Blocked | Context exceeds window (disabled) |

## Tips

- **Pin early** — if a message contains a critical decision, pin it right away
- **Use `/compact` with instructions** when you know what matters
- **Save guidance for thread** on long implementation threads
- **Check the meter before large tool chains** — if context is already high, consider compacting first
- **Watch inline events** — compaction events in the timeline show exactly what changed
