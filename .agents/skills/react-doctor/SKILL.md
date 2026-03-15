---
name: react-doctor
description: Run React Doctor diagnostics to catch React anti-patterns, performance issues, and compiler incompatibilities after completing any task that touches renderer code (src/renderer/). This skill should be used as a final verification step before presenting work for review.
---

# React Doctor

## Overview

React Doctor is a CLI diagnostic tool that scans React codebases for security, performance, correctness, and architecture issues, outputting a 0-100 health score with actionable diagnostics. It checks 60+ rules across state & effects, performance, architecture, bundle size, security, correctness, accessibility, and framework-specific categories. It auto-detects React 19, React Compiler, TypeScript, and Vite in this project.

## When to use

- After completing any task that modifies `src/renderer/` files.
- As a final verification step before presenting work for review.
- When investigating React Compiler compatibility issues.
- When auditing component quality, state management patterns, or accessibility.

## Workflow

### Step 1: Run diagnostics

For tasks on a feature branch (most common):

```bash
npx -y react-doctor@latest . --verbose --diff main
```

For full project audit:

```bash
npx -y react-doctor@latest . --verbose
```

For a quick score check:

```bash
npx -y react-doctor@latest . --score
```

To skip dead code detection (faster, lint-only):

```bash
npx -y react-doctor@latest . --verbose --no-dead-code
```

When prompted to select projects, choose `openwaggle`.

### Step 2: Interpret results

**Score scale:**

| Range | Label | Action |
|-------|-------|--------|
| 90-100 | Excellent | No action needed |
| 75-89 | Good | Address errors, warnings optional |
| 50-74 | Needs work | Errors must be fixed |
| <50 | Critical | Significant issues require attention |

**Severity levels:**

- **Errors** (`✗`) — Must fix. React Compiler optimization failures, security issues, correctness bugs.
- **Warnings** (`⚠`) — Should fix if straightforward. Performance anti-patterns, architecture smells, accessibility gaps.

### Step 3: Fix errors

Address all **errors** found in the scan. Consult `references/common-fixes.md` for patterns specific to this project. Focus on:

1. React Compiler compatibility issues (highest priority — blocks optimization).
2. Correctness bugs (stale closures, derived state anti-patterns).
3. Security issues.

Warnings are informational — fix if the change is low-risk and quick, skip if architectural.

### Step 4: Re-run and verify

After fixing errors, re-run the same diagnostic command from Step 1. Verify:

1. The score did not drop from the previous run.
2. No new errors were introduced by the fixes.
3. The fixed errors no longer appear.

## Configuration

The project uses `react-doctor.config.json` at the repo root:

```json
{
  "ignore": {
    "files": [".Codex/worktrees/**", ".codex/worktrees/**"],
    "rules": []
  }
}
```

- `ignore.files` — Glob patterns to exclude (worktrees, generated code).
- `ignore.rules` — Rules to suppress using `plugin/rule` format.

To suppress a rule project-wide, add it to `ignore.rules`. To suppress for specific files, add glob patterns to `ignore.files`.

## Project context

This project uses **React 19 + React Compiler** (`babel-plugin-react-compiler` configured in `electron.vite.config.ts`). React Doctor auto-detects this and applies compiler-specific rules. Key constraints:

- **No ref access during render** — refs must only be read in event handlers or effects.
- **No synchronous setState in effect bodies** — causes cascading renders the compiler cannot optimize.
- **No value blocks in try/catch** — compiler limitation with conditional/optional chaining inside try blocks.
- **Derived state must be computed during render** — not via useEffect + setState.

Per project conventions in `AGENTS.md`: never use `React.memo()`, `useMemo()`, or `useCallback()` for render optimization — the React Compiler handles memoization automatically.
