---
name: code-review
description: Review OpenHive pull requests and local diffs with repository-specific stack checks. Use for PR reviews, branch audits, and regression/security checks in this project.
license: Complete terms in LICENSE.txt
---

# Code Review

OpenHive-specific review workflow for this repository.

## When to use
- Review pull requests or local branch changes in this repo.
- Audit risky changes before merge.
- Validate fixes after review comments.

## Review priorities
1. Security and auth regressions.
2. Correctness and behavior regressions.
3. IPC contract and process-boundary correctness.
4. Missing or weak verification for behavior changes.
5. Maintainability and convention drift.

## Workflow
1. Load required project context before reviewing.
- Read `AGENTS.md` first.
- Read `LEARNINGS.md` sections 1-4 (skip archive).
- If UI is touched, read `docs/product/ui-interaction-prd.md` and align findings to related `HC-UI-*` item(s).
2. Map the diff and risk profile.
```bash
python3 .codex/skills/code-review/scripts/pr_analyzer.py --base origin/main
```
3. Run guardrail checks on changed files.
```bash
python3 .codex/skills/code-review/scripts/code_quality_checker.py --base origin/main
```
4. Inspect changed files manually with the references listed below.
5. Run verification commands suggested by the analyzer and required OpenHive checks:
- `pnpm typecheck`
- `pnpm lint`
- `pnpm check`
- If behavior changed in renderer UI, call out manual validation expectations via `pnpm dev` (project has no automated test framework configured).
6. Produce a Codex-compatible review response.

## OpenHive stack checks (must enforce)
- Electron process boundaries:
  - `src/main/`: agent loop, tools, IPC handlers, persistence.
  - `src/preload/`: typed bridge only, no business logic drift.
  - `src/renderer/src/`: UI/state only.
- IPC correctness:
  - Treat `src/shared/types/ipc.ts` as source of truth for invoke/send/event channel contracts.
  - Flag channel changes not wired consistently across main, preload, and renderer.
- Provider/model architecture:
  - Preserve provider-registry model resolution flow in `src/main/providers/` and `src/main/agent/agent-loop.ts`.
  - Flag hardcoded provider logic bypassing registry lookup.
- Type/runtime safety:
  - No `any` in new code.
  - Prefer Zod validation and discriminated unions where boundaries exist.
- React/renderer performance conventions:
  - Flag `React.memo`, `useMemo`, `useCallback` used purely for render optimization in compiler-managed code.
  - Flag broad Zustand subscriptions without selectors.
- Environment access:
  - Flag direct `process.env` or `import.meta.env` usage outside approved env modules.

## Codex review output contract
- List findings first, ordered by severity.
- Include concrete file + line references for each finding.
- Focus on: bug risk, regressions, IPC/type-contract drift, security, and missing verification.
- If no findings exist, say so explicitly and note residual risk/testing gaps.
- Keep summary short and secondary.

## Inline comment directives (Codex desktop)
Emit one `::code-comment{...}` per finding when inline comments are requested or useful.

Example:
```text
::code-comment{title="[P1] IPC contract mismatch" body="Renderer invokes `git:status` but preload bridge does not expose the channel, which will fail at runtime for header refresh behavior." file="/Users/diego.garciabrisa/Desktop/Projects/personal/openhive/src/preload/api.ts" start=48 end=58 priority=1 confidence=0.93}
```

## Severity rubric
- `P0`: Security vulnerability, data loss/corruption, or release blocker.
- `P1`: High-probability functional bug or major regression.
- `P2`: Correctness/maintainability issue with moderate impact.
- `P3`: Minor issue, polish, or non-blocking improvement.

## Verification guidance for this repo
- Type-level or architecture-affecting changes: run `pnpm typecheck`.
- Lint or convention-sensitive changes: run `pnpm lint`.
- General validation gate: run `pnpm check`.
- Renderer behavior changes: require manual validation notes via `pnpm dev` flow.
- Docs/skills-only changes: code checks are optional unless scripts/code paths were modified.

## Project guardrails to enforce
- Do not manually edit generated files/artifacts.
- Preserve typed IPC maps and avoid channel drift between process layers.
- Preserve branded IDs and discriminated unions in shared types.
- Preserve provider registry flow; avoid per-provider branching in call sites.
- Flag insecure/inconsistent env access (`process.env` outside approved modules).
- Require verification evidence for behavior changes, or explicit rationale for missing coverage.

## References
- `references/code_review_checklist.md`
- `references/coding_standards.md`
- `references/common_antipatterns.md`

## Utility scripts
- `scripts/pr_analyzer.py`: classify changed files, risk, and recommended verification commands.
- `scripts/code_quality_checker.py`: run stack-specific static guardrail checks.
- `scripts/review_report_generator.py`: generate a markdown review scaffold from analyzer/checker outputs.
