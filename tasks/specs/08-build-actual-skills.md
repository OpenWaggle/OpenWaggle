# Build Actual Skills

**Priority:** 8 — Value
**Depends on:** Nothing (skill infrastructure already exists)
**Blocks:** Nothing

---

## Problem

The skill system machinery is sophisticated (dynamic loading, path-scoped resolution, metadata-first discovery, slash-command integration, enable/disable toggles per project) but there are barely any skills to use. The infrastructure is an empty factory.

## What Exists

- `src/main/tools/tools/load-skill.ts` — Runtime skill loading tool
- `src/main/tools/tools/load-agents.ts` — Runtime agents.md loading
- `.openwaggle/skills/` directory structure convention
- `src/renderer/src/components/skills/SkillsPanel.tsx` — Full UI for browsing/toggling skills
- `src/renderer/src/components/composer/SlashMenu.tsx` — Slash command autocomplete for skill references
- `src/main/agent/standards-context.ts` — Skill discovery and metadata parsing

## Skills to Build (In Order of User Value)

### 8a. Code Review — `.openwaggle/skills/code-review/SKILL.md`

- Reads git diff, analyzes changes, produces structured review
- Checks for: security issues, type safety, error handling, test coverage gaps
- Output format: file-by-file comments with severity levels
- Uses existing tools: `glob`, `readFile`, `runCommand` (for `git diff`)
- Trigger phrases: "review", "code review", "check my changes"

### 8b. Test Generation — `.openwaggle/skills/test-gen/SKILL.md`

- Given a source file, generates comprehensive tests
- Detects test framework from project config (vitest, jest, mocha)
- Reads existing test patterns in the project and matches style
- Generates: unit tests, edge cases, error scenarios
- Uses existing tools: `readFile` (source + existing tests), `writeFile` (new tests), `runCommand` (run tests to verify)
- Trigger phrases: "generate tests", "add tests for", "test this"

### 8c. Dependency Audit — `.openwaggle/skills/dep-audit/SKILL.md`

- Reads `package.json` + lock file
- Identifies: outdated deps, known vulnerabilities, unused deps, duplicate deps
- Suggests specific upgrade commands
- Uses: `readFile`, `runCommand` (`npm audit`, `pnpm outdated`)
- Trigger phrases: "audit deps", "check dependencies", "security scan"

### 8d. PR Description Writer — `.openwaggle/skills/pr-writer/SKILL.md`

- Reads git log and diff between current branch and main
- Produces structured PR description: summary, changes by file, testing notes, breaking changes
- Outputs as markdown ready to paste
- Uses: `runCommand` (git log, git diff), `readFile` (changed files for context)
- Trigger phrases: "write PR", "PR description", "describe my changes"

### 8e. Migration Helper — `.openwaggle/skills/migrate/SKILL.md`

- Helps with framework/library migrations (e.g., React 18→19, Tailwind v3→v4)
- Reads project deps, identifies migration targets
- Applies known codemods or suggests manual changes
- Uses: `readFile`, `editFile`, `runCommand`
- Trigger phrases: "migrate", "upgrade", "update framework"

## Skill File Format

Per `CLAUDE.md` skill standard:
```
.openwaggle/skills/<skill-id>/
  SKILL.md          — Frontmatter (name, description, triggers) + full instructions
  scripts/          — Optional helper scripts
```

SKILL.md frontmatter format:
```yaml
---
name: Code Review
description: Analyze git changes for bugs, security issues, and style violations
triggers:
  - review
  - code review
  - check my changes
---
```

## Files to Create

- `.openwaggle/skills/code-review/SKILL.md`
- `.openwaggle/skills/test-gen/SKILL.md`
- `.openwaggle/skills/dep-audit/SKILL.md`
- `.openwaggle/skills/pr-writer/SKILL.md`
- `.openwaggle/skills/migrate/SKILL.md`

## No Code Changes Needed

Skills are pure markdown instruction files that the existing infrastructure loads at runtime.
