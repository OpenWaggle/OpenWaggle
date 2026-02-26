# Spec 51: Recreate Memory Skill via Skill Creator

## Plan

- [x] Remove existing `memory-safe-attachment-hydration` skill folders from `.openwaggle/skills`, `.claude/skills`, and `.codex/skills`.
- [x] Recreate each skill folder using `skill-creator/scripts/init_skill.py`.
- [x] Apply the canonical `SKILL.md` content consistently in all three recreated folders.
- [x] Generate `agents/openai.yaml` in all three folders using `skill-creator/scripts/generate_openai_yaml.py`.
- [x] Validate each recreated skill with `skill-creator/scripts/quick_validate.py`.
- [x] Document verification results in the review section.

## Review

- Recreated skills from scratch under `.openwaggle/skills/`, `.claude/skills/`, and `.codex/skills/` using `skill-creator` tooling.
- Applied identical `SKILL.md` content and regenerated `agents/openai.yaml` for all three folders.
- Validation results:
  - `.openwaggle/skills/memory-safe-attachment-hydration`: `Skill is valid!`
  - `.claude/skills/memory-safe-attachment-hydration`: `Skill is valid!`
  - `.codex/skills/memory-safe-attachment-hydration`: `Skill is valid!`
