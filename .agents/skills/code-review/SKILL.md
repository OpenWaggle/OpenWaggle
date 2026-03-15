---
name: code-review
description: Principle-based code review for pull requests and local diffs. This skill should be used for PR reviews, branch audits, regression checks, and code quality assessments. Evaluates changes against SRP, DRY, clean code, test coverage, security, and performance principles.
---

# Code Review

Principle-based review workflow for evaluating code changes against engineering best practices.

## When to use

- Review pull requests or local branch changes.
- Audit risky changes before merge.
- Validate fixes after review comments.
- Assess code quality against established principles.

## Review priorities (ordered)

1. **Security** — vulnerabilities, auth regressions, data exposure.
2. **Correctness** — logic bugs, behavior regressions, data integrity.
3. **Test coverage** — missing or weak tests for behavior changes.
4. **Design principles** — SRP, DRY, SOLID, clean code violations.
5. **Performance** — unnecessary work, inefficient patterns, resource leaks.
6. **Maintainability** — readability, convention drift, dead code.

## Workflow

1. **Load project context** before reviewing.
   - Read project instructions (`AGENTS.md`, `AGENTS.md`, or equivalent).
   - Read learnings/lessons files if they exist.
   - If UI is touched, read relevant product/design docs.

2. **Map the diff and risk profile.**
   ```bash
   python3 .Codex/skills/code-review/scripts/pr_analyzer.py --base origin/main
   ```

3. **Run automated guardrail checks.**
   ```bash
   python3 .Codex/skills/code-review/scripts/code_quality_checker.py --base origin/main
   ```

4. **Apply the principle-based review** using the references below. Evaluate every changed file against:
   - Single Responsibility Principle — does each unit do one thing?
   - DRY — is knowledge duplicated across the change?
   - Clean Code — naming, readability, function length, nesting depth?
   - Test Coverage — are behavior changes covered? Failure paths too?
   - Security — input validation, auth checks, data exposure?
   - Performance — unnecessary allocations, N+1 patterns, missing cleanup?

5. **Run verification commands** suggested by the analyzer plus any project-specific checks (typecheck, lint, test).

6. **Produce the review output** per the output contract below.

## Principles to enforce

### Single Responsibility (SRP)
- Each function, module, and component should have one reason to change.
- Flag functions exceeding ~40 lines or handling multiple concerns.
- Flag components mixing data fetching, business logic, and presentation.

### Don't Repeat Yourself (DRY)
- Flag duplicated logic, constants, or patterns across files.
- Flag copy-pasted code with minor variations that should be abstracted.
- Balance: three similar lines are better than a premature abstraction.

### Clean Code
- Names should reveal intent — no single-letter variables outside loops, no abbreviations.
- Functions should be short, do one thing, and operate at one abstraction level.
- Flag deep nesting (>3 levels), long parameter lists (>4), and boolean blindness.
- Comments should explain "why", not "what" — flag obvious or outdated comments.

### SOLID beyond SRP
- **Open/Closed** — extend through composition, not modification of existing code.
- **Liskov Substitution** — subtypes must honor parent contracts.
- **Interface Segregation** — no client should depend on methods it doesn't use.
- **Dependency Inversion** — depend on abstractions, not concrete implementations.

### Test coverage
- Behavior changes require updated or new tests.
- Test failure paths, edge cases, and boundary conditions — not just happy paths.
- Flag test duplication, brittle assertions, and missing error-case coverage.
- For UI changes, require manual validation notes or automated visual/E2E tests.

### Security
- Validate all external input at trust boundaries (user input, API responses, IPC).
- Preserve auth/access checks on protected paths — flag removals.
- Flag secrets or credentials appearing outside secure modules.
- Flag SQL/command injection vectors, XSS risks, and unescaped user data.
- Flag overly permissive CORS, missing rate limits, and insecure defaults.

### Performance
- Flag unnecessary re-renders, re-computations, or re-fetches.
- Flag missing cleanup for subscriptions, timers, and event listeners.
- Flag O(n^2) patterns where O(n) solutions exist.
- Flag synchronous blocking in async contexts.
- Flag unbounded data fetching without pagination or limits.
- Only flag performance issues with evidence — avoid premature optimization calls.

### Error handling
- Async failures must be handled or propagated — never silently swallowed.
- Error boundaries should exist at appropriate component/service boundaries.
- Flag bare catch blocks with no logging or re-throw.
- Structured error logging should include context (component, action, error).

## Review output contract

- List findings first, ordered by severity.
- Include concrete `file:line` references for each finding.
- Cite the violated principle for each finding.
- Focus on: bug risk, regressions, security, missing tests, design violations.
- If no findings exist, state so explicitly and note residual risk/testing gaps.
- Keep summary short and secondary to findings.

## Severity rubric

- `P0`: Security vulnerability, data loss/corruption, or release blocker.
- `P1`: High-probability functional bug or major regression.
- `P2`: Correctness/maintainability issue with moderate impact (SRP, DRY violations).
- `P3`: Minor issue, polish, or non-blocking improvement.

## References

- `references/code_review_checklist.md` — ordered checklist for systematic reviews.
- `references/coding_standards.md` — universal coding standards by domain.
- `references/common_antipatterns.md` — patterns to flag across codebases.

## Utility scripts

- `scripts/pr_analyzer.py` — classify changed files, assess risk, and recommend verification commands.
- `scripts/code_quality_checker.py` — run static guardrail checks on changed files.
- `scripts/review_report_generator.py` — generate a markdown review scaffold from analyzer/checker outputs.
