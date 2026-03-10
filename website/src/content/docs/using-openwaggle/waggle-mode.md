---
title: "Waggle Mode"
description: "Multi-agent collaboration where two AI agents take turns working on the same problem, then synthesize a final answer."
order: 2
section: "Using OpenWaggle"
---

Waggle Mode is OpenWaggle's flagship feature. It pairs two AI agents on the same problem and lets them collaborate in structured turns — like bees performing a waggle dance to converge on the best solution.

## How It Works

In Waggle Mode, two agents take turns working on your task:

1. **Agent A** receives the task and produces a response (including tool calls).
2. **Agent B** receives the task plus Agent A's output and builds on it, challenges it, or takes a different approach.
3. This continues for a configurable number of turns.
4. When the agents converge (or reach the turn limit), a **synthesis step** combines their contributions into a final answer.

Each agent can use all available tools (file operations, shell commands, etc.) during their turn.

## Setting Up a Team

### From Settings

1. Open **Settings** from the sidebar.
2. Navigate to **Waggle Mode**.
3. Configure your team:
   - **Agent A**: Select a model, assign a role description, and pick a color.
   - **Agent B**: Same configuration with a different model.
   - **Max turns**: How many back-and-forth rounds before forced synthesis (default varies by preset).
   - **Collaboration style**: Sequential turns.

### From the Command Palette

1. Press `Cmd+K` / `Ctrl+K` to open the command palette.
2. Search for "waggle" to see available presets.
3. Select a preset to start a Waggle session immediately.

## Team Presets

OpenWaggle includes 3 built-in presets, and you can create unlimited custom ones:

### Built-in Presets

Presets pair models with complementary strengths. For example, pairing a fast model for exploration with a thorough model for validation.

### Creating Custom Presets

1. Go to **Settings > Waggle Mode**.
2. Configure both agents (model, role, color).
3. Set collaboration parameters.
4. Save as a named preset.

## Consensus Detection

Waggle Mode automatically detects when agents converge on a solution:

- **Agreement check** — If both agents produce similar output (measured by text similarity) for consecutive turns, the system detects consensus.
- **Explicit agreement** — Phrases indicating agreement are recognized.
- **Diminishing returns** — When responses stop adding new information, the session moves to synthesis.

The confidence threshold is 0.7 (70% similarity) for triggering consensus.

## Synthesis Step

After reaching consensus or the turn limit, a neutral agent (not assigned to either "side") generates a structured synthesis:

- **Agreed points** — What both agents converged on.
- **Disagreements** — Where they diverged and why.
- **Key findings** — Important discoveries from the collaboration.
- **Open questions** — Unresolved items for you to consider.
- **Recommendation** — The synthesized best approach.

## Conflict Tracking

When both agents modify the same files, Waggle Mode tracks these conflicts:

- A warning appears showing which files were modified by both agents.
- This helps you identify areas that need manual review.

## Approval in Waggle Mode

In Waggle Mode, tool execution is automatic (no per-tool approval prompts). This is by design — the multi-turn collaboration would be impractical if every tool call required manual approval. The auto-approval is scoped only to the active Waggle session and uses a branded security token internally.

## When to Use Waggle Mode

Waggle Mode works best for:

- **Code review** — Have one agent write code and another review it.
- **Architecture decisions** — Let two models debate trade-offs.
- **Bug investigation** — Two perspectives on the same problem.
- **Refactoring** — One agent proposes changes, another validates them.
- **Complex tasks** — Problems that benefit from iterative refinement.

For simple, straightforward tasks, single-agent mode is usually faster and more efficient.
