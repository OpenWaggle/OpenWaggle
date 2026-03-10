---
title: "AGENTS.md"
description: "Project-wide and directory-scoped agent instructions using AGENTS.md files."
order: 3
section: "Extending"
---

`AGENTS.md` files provide project-wide instructions that the agent follows during every conversation.

## How It Works

- Place an `AGENTS.md` in your project root to give the agent baseline instructions for every run.
- Place additional `AGENTS.md` files in subdirectories to provide scoped instructions for specific areas of your codebase.
- When the agent works in a directory, it automatically picks up the nearest `AGENTS.md` instructions.

## What to Include

Use `AGENTS.md` for things like:

- **Project conventions** — Coding standards, naming patterns, preferred libraries.
- **Architecture context** — How the project is structured, key design decisions.
- **Workflow rules** — Testing requirements, commit message formats, review processes.
- **Warnings** — Areas of the codebase that need special care, known gotchas.

## Example

```markdown
# AGENTS.md

## Conventions
- Use TypeScript strict mode.
- Always use pnpm, never npm or yarn.
- Write tests for all new features.

## Architecture
- API routes live in src/api/.
- Shared types live in src/types/.
- Do not modify generated files in src/generated/.
```

## AGENTS.md vs Skills

- **AGENTS.md** — Always active, provides baseline context for every conversation. Best for project-wide rules.
- **Skills** — Activated on demand, loaded only when needed. Best for specialized workflows (e.g., "run this audit", "follow this migration guide").

See [Skills System](/docs/extending/skills-system) for more on skills.
