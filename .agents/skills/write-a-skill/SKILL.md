---
name: write-a-skill
description: Create or update agent skills with progressive disclosure, strong metadata, and optional bundled scripts/references/assets. Use when the user wants to create, write, update, migrate, or package a skill.
license: Complete terms in LICENSE.txt
---

# Write A Skill

Create skills as reusable agent expertise, not as long-form documentation dumps.

## Skill Shape

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
5. Write metadata carefully. The `name` and `description` determine when agents load the skill.
6. Use imperative, objective instructions. Avoid chatty second-person prose.
7. Validate/package with the bundled scripts when useful:

```bash
scripts/quick_validate.py <path/to/skill-folder>
scripts/package_skill.py <path/to/skill-folder>
```

## Metadata Requirements

- `name` is required and should match the folder id.
- `description` is required and should say what the skill does and when to use it.
- Descriptions should be specific enough for an agent to choose between adjacent skills.

## Progressive Disclosure

- Metadata is always visible.
- `SKILL.md` is loaded when the skill triggers.
- Scripts and references are loaded only when needed.

Do not duplicate the same rule in multiple files. Prefer one canonical location and link to it.
