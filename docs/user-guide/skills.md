# Skills

Skills extend the agent's capabilities with specialized knowledge and workflows. They live in your project repository and can be enabled, disabled, or activated on demand.

## What Are Skills?

A skill is a folder inside `.openwaggle/skills/` containing a `SKILL.md` file. The markdown file provides specialized instructions, patterns, and workflows that the agent can load during a conversation.

For example, a "react-doctor" skill might include React Compiler compatibility rules and code quality audit workflows that the agent follows when working on your React components.

## Discovering Skills

### Skills Panel

Click **Skills** in the sidebar to open the Skills panel. It shows:

- **AGENTS.md status** — Whether a root `AGENTS.md` file exists in your project (found/missing/error).
- **Skill catalog** — All skills discovered in `.openwaggle/skills/`. Each skill shows:
  - Name and description (from SKILL.md frontmatter).
  - Skill ID (the folder name).
  - Enable/disable toggle.
  - "Invalid" badge if the SKILL.md is malformed.
- **Preview pane** — Select a skill to see its full SKILL.md content rendered as markdown.

### Slash References

Type `/` in the composer to open the command palette, then select a skill to reference it. This inserts `/skill-id` into your message, which activates that skill for the current agent run.

Multiple skill references can be included in the same message.

## Enabling and Disabling Skills

Toggle each skill on or off using the switch in the Skills panel. Toggles are **per-project** — enabling a skill in one project doesn't affect other projects.

Disabled skills:
- Don't appear in slash-reference suggestions.
- Cannot be loaded by the agent mid-run via `loadSkill`.
- Still appear in the catalog for reference.

## How Skills Are Loaded

Skills use a **metadata-first** approach:

1. **At run start** — The agent receives only skill metadata (ID, name, description) in its system prompt. This keeps the initial context small.
2. **On demand** — When the agent determines a skill is relevant, it calls `loadSkill` to fetch the full SKILL.md instructions.
3. **Via slash reference** — When you include `/skill-id` in your message, the skill's full instructions are loaded at the start of that run.

Loaded skills are **run-scoped** — they persist for the duration of one agent response but don't automatically carry over to the next message.

## Creating Custom Skills

### Folder Structure

```
.openwaggle/
  skills/
    my-skill/
      SKILL.md          # Required: skill instructions
      scripts/           # Optional: bundled scripts or resources
      templates/         # Optional: templates the skill references
```

### SKILL.md Format

```markdown
---
name: My Custom Skill
description: A brief description of what this skill does
---

# My Custom Skill

## When to Use

Describe when the agent should activate this skill.

## Instructions

Step-by-step instructions, patterns, code examples, or workflows.

## Rules

Any constraints or rules the agent should follow.
```

The frontmatter (`name` and `description`) is required for the skill to appear in the catalog. The body content is what the agent receives when the skill is loaded.

### Best Practices

- **Keep descriptions actionable** — The agent uses the description to decide whether to load the skill.
- **Include clear triggers** — Describe the scenarios where this skill applies.
- **Be specific** — Concrete patterns, code examples, and command sequences work better than vague guidance.
- **Bundle resources** — If the skill references scripts or templates, keep them in the same skill folder.

## AGENTS.md

In addition to skills, OpenWaggle supports `AGENTS.md` files for project-wide agent instructions.

### How It Works

- A root `AGENTS.md` in your project provides baseline instructions for every agent run.
- Nested `AGENTS.md` files in subdirectories provide scoped instructions that apply when the agent works in those areas.
- The resolution order is: root baseline, then ancestor directories, then the nearest `AGENTS.md` to the target path.

### Scoped Loading

The agent can call `loadAgents` mid-run to load scoped instructions for a specific path without restarting the conversation. Missing or malformed `AGENTS.md` files produce a warning but never block execution.

## Bundled Skills

OpenWaggle ships with several built-in skills in the `.openwaggle/skills/` directory:

| Skill | Purpose |
|-------|---------|
| `react-doctor` | React Compiler compatibility and code quality audits |
| `orchestration-fallback-streaming` | Debug orchestration handoff issues |
| `openai-codex-subscription-transport` | Handle OpenAI billing edge cases |
| `memory-safe-attachment-hydration` | Attachment processing patterns |
| `zod-v4` | Zod v4 validation patterns and migration from v3 |

These can be enabled/disabled per project like any other skill.
