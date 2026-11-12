---
name: code-review
description: Review pull requests and local diffs for correctness, regressions, security, missing tests, architecture drift, and maintainability. Use for PR reviews, branch audits, regression checks, and code quality assessments.
---

# Code Review

Review for bugs first. Summaries are secondary.

## Workflow

1. Load `AGENTS.md`, the `MEMORY.md` index (then only the `.agents/memory/` topics the diff touches), `.agents/standards.md`, and `.agents/verification.md`.
2. Inspect the diff and current dirty tree, then run `bun scripts/check-no-cheating.ts --base <merge base>` and `bun run check:changed` once. They print the mechanical findings for the changed files, each naming its lint rule or `no-cheating/<kind>`; review effort goes to the rules no tool checks.
3. Run the bundled analyzers when useful:

```bash
python3 .agents/skills/code-review/scripts/pr_analyzer.py --base origin/main
python3 .agents/skills/code-review/scripts/code_quality_checker.py --base origin/main
```

4. Apply the repository standards before generic style preferences.
5. Run or recommend the relevant verification commands.
6. Report findings first, ordered by severity.

## Review Priorities

1. Security and data loss.
2. Correctness and behavioral regressions.
3. Missing tests or weak validation.
4. Architecture boundary drift.
5. Type-safety regressions.
6. Performance issues with evidence.
7. Maintainability issues.

## OpenWaggle-Specific Checks

- Pi SDK imports stay under `src/main/adapters/pi/`.
- Main-process code follows the domain/ports/adapters/application/IPC/store split.
- Renderer feature boundaries use public indexes for cross-feature imports.
- Raw type assertions are forbidden except `as const`; tests may use Shoehorn only in test files.
- Runtime inputs use Effect Schema or explicit guards.
- Check whether manual multi-branch discriminant/shape logic, runtime guards, or boundary assertions should use `@diegogbrisa/ts-match`; load `.agents/skills/ts-match/SKILL.md` before recommending changes.
- No stale legacy instruction files or vendor-specific agent config are reintroduced.
- UI/IPC changes have Electron QA coverage or a clearly stated gap.

## Independent Review

For a review that must be independent (the `ready` skill, or any review of work you wrote), spawn a Hive Worker from the `standards-reviewer` Agent definition (`.agents/agents/standards-reviewer.md`) instead of reviewing yourself. It follows this skill with fresh context, cites what each finding breaks, and never edits.

## Output Contract

- Findings first, ordered by severity.
- Include concrete file and line references.
- Cite what the finding breaks: a lint rule name (`[import/no-cycle]`), a check step or no-cheating kind (`[no-cheating/cast]`), or a standards section (`[standards.md#main-process-architecture]`); `[none]` when it breaks none, with why it matters.
- Explain the impact.
- If no findings exist, state that and list residual risks/testing gaps.
- Keep the summary short.

## Severity

- `P0`: security issue, data loss/corruption, release blocker.
- `P1`: high-probability functional bug or major regression.
- `P2`: moderate correctness, test, architecture, or maintainability issue.
- `P3`: minor improvement or polish.

## References

- `references/code_review_checklist.md`
- `references/coding_standards.md`
- `references/common_antipatterns.md`
