---
title: "Project instructions"
description: "Add an AGENTS.md file with the commands, conventions, and constraints the agent should follow."
order: 3
section: "Customize"
kind: "guide"
---

An `AGENTS.md` file holds the instructions you would otherwise repeat at the start of every conversation: which commands to run, which files to leave alone, and what to check before calling a task done. Put it in your project root. Pi, the agent runtime inside OpenWaggle, adds it to the agent's context in every session for that project.

## Write an AGENTS.md

Start with a short file. This one covers the three things agents most often get wrong:

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

Replace the paths and commands with ones that exist in your repository. Commit the file if you want your team to share the instructions.

To check that OpenWaggle found the file, open **Settings > Skills** and choose the project. The panel shows whether the root `AGENTS.md` is there.

## Decide what to include

Write down what the agent cannot work out from the code:

- The package manager and the exact test commands.
- Repository conventions and architecture rules.
- Generated files and areas that need special care.
- What you expect for review, commits, and reporting failures.

Keep the file current. An outdated test command misleads the agent on every task.

## Add instructions for one folder

You can put another `AGENTS.md` in a subdirectory for rules that only apply there. Keep the root file short and point to those files when the agent needs the detail. Pi loads a context file for the directory it runs in and the directories above it, so do not expect every nested file to be in every conversation.

## Know what instructions cannot do

Instructions are text the agent reads. They are not access controls. A rule such as "do not edit generated files" does not stop a tool from writing there. To review actions before they happen, use [approvals and permissions](/docs/configuration/approvals-permissions).

## Choose between AGENTS.md, skills, and agent definitions

`AGENTS.md` sets the rules for the whole project. A [skill](/docs/extending/skills-system) is a workflow for one kind of task, such as a code review, that the agent loads when it needs it.

[Agent definitions](/docs/extending/agent-definitions) give a new session a role and defaults. They do not set conventions for the project.
