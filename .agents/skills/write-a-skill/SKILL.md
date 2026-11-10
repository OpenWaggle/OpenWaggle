---
name: write-a-skill
description: Create or update agent skills with progressive disclosure, strong metadata, and optional bundled scripts/references/assets. Use when the user wants to create, write, update, migrate, or package a skill.
license: Complete terms in LICENSE.txt
---

# Write a skill

Create skills as reusable agent expertise, not as long-form documentation dumps.

## Skill shape

Every skill has a required `SKILL.md` file and optional resources:

```text
skill-name/
  SKILL.md
  scripts/      # deterministic helpers
  references/   # detailed docs loaded only when needed
  assets/       # files used as output/input assets
```

## Process

1. Understand concrete usage examples.
2. Identify what should be in `SKILL.md` versus `scripts/`, `references/`, or `assets/`.
3. For new skills, run the bundled initializer:

```bash
scripts/init_skill.py <skill-name> --path <output-directory>
```

4. Keep `SKILL.md` lean. Move detailed reference material into `references/`.
5. Write metadata carefully. The `name` and `description` decide when agents load the skill (see "Descriptions are context pointers" below).
6. Use imperative, objective instructions. Avoid chatty second-person prose.
7. Validate/package with the bundled scripts when useful:

```bash
scripts/quick_validate.py <path/to/skill-folder>
scripts/package_skill.py <path/to/skill-folder>
```

## Metadata requirements

- `name` is required and should match the folder id.
- `description` is required and should say what the skill does and when to use it.
- Descriptions should be specific enough for an agent to choose between adjacent skills.

## Descriptions are context pointers

A skill's description is a pointer to material the agent has not read yet, and so is every line of always-loaded text: `AGENTS.md`, the skills listing, tool descriptions and tool rules, plus the `MEMORY.md` index that `AGENTS.md` sends agents to before non-trivial work. The agent sees only the pointer. Its wording decides whether the agent ever opens what it points to, so write it for the moment the agent should follow it, not as a summary of the contents.

- Give each distinct case its own trigger. A skill that applies when touching `src/main/adapters/pi/` and also when upgrading Pi names both. One abstract phrase such as "Pi work" matches neither request well.
- Front-load the leading word. Start the trigger with the word a request will contain ("Renderer", "Release", "Migration"), not with "This skill should be used when". Agents scan the first words of each pointer.
- Keep the trigger sentence whole. The skills listing caps each description at 160 characters in `src/main/adapters/pi/pi-skill-prompt-listing.ts`. A long description keeps its "Use when" sentence and loses the opening before it, so the words an agent matches on belong in that sentence.
- Name concrete things a request mentions: paths, commands, file names, error text.
- Say when not to load a skill only when an adjacent skill would be confused with it.

## Always-loaded text costs tokens every turn

Skill metadata, tool declarations and `AGENTS.md` are in the prompt of every model call in every Session, and most Sessions read `MEMORY.md` too. Each added line is paid again on every turn. `SKILL.md` bodies, references and memory topic files cost tokens only when an agent opens them. Put a fact behind a pointer unless the agent needs it to decide what to read.

Measure before and after an edit with the o200k tokenizer that the first-turn prefix budget in `scripts/perf/first-turn-prefix` and the memory caps use:

```bash
bun run tokens:count AGENTS.md MEMORY.md .agents/skills/<skill>/SKILL.md
printf '%s' "<description text>" | bun run tokens:count
```

Report the token delta of every change to always-loaded text. A new pointer has to save more reading than it costs on every turn.

## Vendored skills

`skills-lock.json` pins each skill copied from another repository to its upstream repository, path, commit and content hash. After editing a vendored skill, record the edit and the reason with `bun scripts/skills-lock.ts record <skill> --reason "<why>"`. A skill written in this repository goes under `firstParty` in the same file. `bun scripts/skills-lock.ts drift` fetches each upstream and reports what changed since the pinned commit.

## Progressive disclosure

- Metadata is always visible.
- `SKILL.md` is loaded when the skill triggers.
- Scripts and references are loaded only when needed.

Do not duplicate the same rule in multiple files. Prefer one canonical location and link to it.
