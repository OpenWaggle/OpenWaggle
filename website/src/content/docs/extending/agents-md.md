---
title: "Project instructions"
description: "Add an AGENTS.md file with the commands, conventions, and constraints the agent should follow."
order: 3
section: "Customize"
---

Create an `AGENTS.md` file in your project root to give the agent instructions you would otherwise repeat in each conversation. Include the commands it should use, files it should leave alone, and checks it should run before reporting a task complete.

## Example

```markdown
# Project instructions

## Commands
- Install dependencies with pnpm install.
- Run pnpm test after changing behavior.
- Run pnpm lint before reporting a change complete.

## Conventions
- Use TypeScript strict mode.
- API routes live in src/api/.
- Shared types live in src/types/.
- Do not modify generated files in src/generated/.

## Review
- Report which checks passed, failed, or were not run.
- Do not commit or push unless asked.
```

Replace these paths and commands with ones that exist in your repository. Commit the file if you want the team to share the instructions.

## How it works

Pi, the agent runtime used by OpenWaggle, discovers context files for the active project. OpenWaggle shows root `AGENTS.md` status in **Settings > Skills** and can resolve root and directory-scoped instructions for display.

You can add an `AGENTS.md` in a subdirectory for rules specific to that area. Keep the root file short and point to those files when the agent needs more detail. Do not assume every nested instruction file is loaded into every conversation.

These files are instructions, not access controls. A rule such as "do not edit generated files" does not prevent a tool from writing there. Use the app's [permissions](/docs/configuration/security-privacy) to review protected actions.

## What to include

Prefer details the agent cannot infer reliably from the code:

- The package manager and exact test commands.
- Repository conventions or architectural constraints.
- Generated files and areas that require special care.
- Expectations for review, commits, and reporting failures.

Keep instructions current. An outdated test command can mislead the agent on every task.

## AGENTS.md vs skills

`AGENTS.md` supplies baseline project instructions. A [skill](/docs/extending/skills-system) supplies a workflow for a particular task, such as a code review.

[Agent definitions](/docs/extending/agent-definitions) serve a different purpose. They give a new session an optional role and defaults, rather than setting conventions for the whole project.
