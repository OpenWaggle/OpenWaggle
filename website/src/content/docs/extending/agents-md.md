---
title: "AGENTS.md"
description: "Project-wide and directory-scoped agent instructions using AGENTS.md files."
order: 3
section: "Extending"
---

`AGENTS.md` files provide project instructions. Pi's default resource loader discovers context files, and OpenWaggle also exposes AGENTS status in the Skills panel.

## How It Works

- Place an `AGENTS.md` in your project root to give the agent baseline instructions for every run.
- Place additional `AGENTS.md` files in subdirectories to provide scoped instructions for specific areas of your codebase.
- Pi discovers relevant context files for the active project. OpenWaggle's own resolver can preview root and scoped instructions for the UI.

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

- **AGENTS.md** — Baseline project context discovered by Pi/OpenWaggle for the active project.
- **Skills** — Runtime-loaded through Pi-native resource locations with `.openwaggle > .pi > .agents` project precedence; OpenWaggle also has a catalog UI for skill preview and toggles.

See [Skills System](/docs/extending/skills-system) for more on skills.
