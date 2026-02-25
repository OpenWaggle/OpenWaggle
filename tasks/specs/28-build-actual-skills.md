# 28 — Build Actual Skills

**Status:** Planned
**Priority:** P3
**Category:** Feature
**Depends on:** None (skill infrastructure already exists)
**Origin:** Spec 08

---

## Problem

The skill system machinery is sophisticated but there are barely any skills to use. The infrastructure is an empty factory.

## What Exists

- `src/main/tools/tools/load-skill.ts` — Runtime skill loading tool
- `.openwaggle/skills/` directory structure convention
- `src/renderer/src/components/skills/SkillsPanel.tsx` — Full UI for browsing/toggling
- `src/main/agent/standards-context.ts` — Skill discovery and metadata parsing

## Skills to Build (In Order of User Value)

### 28a. Code Review — `.openwaggle/skills/code-review/SKILL.md`

- Reads git diff, analyzes changes, produces structured review
- Checks for: security issues, type safety, error handling, test coverage gaps
- Uses: `glob`, `readFile`, `runCommand` (for `git diff`)

### 28b. Test Generation — `.openwaggle/skills/test-gen/SKILL.md`

- Given a source file, generates comprehensive tests
- Detects test framework from project config
- Uses: `readFile`, `writeFile`, `runCommand`

### 28c. Dependency Audit — `.openwaggle/skills/dep-audit/SKILL.md`

- Reads `package.json` + lock file
- Identifies: outdated deps, vulnerabilities, unused deps
- Uses: `readFile`, `runCommand`

### 28d. PR Description Writer — `.openwaggle/skills/pr-writer/SKILL.md`

- Reads git log and diff, produces structured PR description
- Uses: `runCommand`, `readFile`

### 28e. Migration Helper — `.openwaggle/skills/migrate/SKILL.md`

- Helps with framework/library migrations
- Uses: `readFile`, `editFile`, `runCommand`

## Files to Create

- `.openwaggle/skills/code-review/SKILL.md`
- `.openwaggle/skills/test-gen/SKILL.md`
- `.openwaggle/skills/dep-audit/SKILL.md`
- `.openwaggle/skills/pr-writer/SKILL.md`
- `.openwaggle/skills/migrate/SKILL.md`

## No Code Changes Needed

Skills are pure markdown instruction files that the existing infrastructure loads at runtime.
