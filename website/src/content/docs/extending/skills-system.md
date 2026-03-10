---
title: "Skills System"
description: "Extend the agent with specialized knowledge and workflows using project-local skills."
order: 1
section: "Extending"
---

Skills extend the agent's capabilities with specialized knowledge and workflows. They live in your project repository and can be enabled, disabled, or activated on demand.

## What Are Skills?

A skill is a folder inside `.openwaggle/skills/` containing a `SKILL.md` file. The markdown file provides specialized instructions, patterns, and workflows that the agent can load during a conversation.

For example, a skill might include code quality audit rules, framework-specific patterns, or step-by-step workflows that the agent follows when working on certain parts of your codebase.

## Discovering Skills

### Skills Panel

Click **Skills** in the sidebar to open the Skills panel. It shows:

- **Skill catalog** — All skills discovered in `.openwaggle/skills/`. Each skill shows its name, description, and an enable/disable toggle.
- **Preview pane** — Select a skill to see its full content rendered as markdown.

### Slash References

Type `/` in the composer to open the command palette, then select a skill to reference it. This activates that skill for the current agent response.

Multiple skill references can be included in the same message.

## Enabling and Disabling Skills

Toggle each skill on or off using the switch in the Skills panel. Toggles are **per-project** — enabling a skill in one project doesn't affect other projects.

Disabled skills don't appear in slash-reference suggestions and can't be loaded by the agent automatically.

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

- Place an `AGENTS.md` in your project root to provide baseline instructions for every agent run.
- Place additional `AGENTS.md` files in subdirectories to provide scoped instructions that apply when the agent works in those areas.
