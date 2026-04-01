#!/usr/bin/env bash
# Quality gates hook — runs all checks and tests after implementation.
# Only runs when source files have uncommitted changes.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

CHANGED=$(git diff --name-only -- 'src/**/*.ts' 'src/**/*.tsx' 2>/dev/null | head -1)
if [ -z "$CHANGED" ]; then
  echo '{"suppressOutput": true}'
  exit 0
fi

ERRORS=""
DETAILS=""

# Format (auto-fix)
FORMAT_OUT=$(pnpm format 2>&1 | tail -1)
DETAILS="${DETAILS}format: ${FORMAT_OUT}\n"

# Lint
if ! LINT_OUT=$(pnpm lint 2>&1); then
  ERRORS="${ERRORS}lint failed; "
  DETAILS="${DETAILS}lint: FAILED\n"
else
  DETAILS="${DETAILS}lint: passed\n"
fi

# Typecheck
if ! TC_OUT=$(pnpm typecheck 2>&1); then
  ERRORS="${ERRORS}typecheck failed; "
  DETAILS="${DETAILS}typecheck: FAILED\n"
else
  DETAILS="${DETAILS}typecheck: passed\n"
fi

# Pattern style (inline imports, switch/else-if)
if ! PATTERN_OUT=$(pnpm check:pattern-style 2>&1); then
  ERRORS="${ERRORS}pattern-style failed; "
  DETAILS="${DETAILS}pattern-style: FAILED\n"
else
  DETAILS="${DETAILS}pattern-style: passed\n"
fi

# Decision size
if ! DS_OUT=$(pnpm check:decision-size 2>&1); then
  ERRORS="${ERRORS}decision-size failed; "
  DETAILS="${DETAILS}decision-size: FAILED\n"
else
  DETAILS="${DETAILS}decision-size: passed\n"
fi

# Magic numbers
if ! MN_OUT=$(pnpm check:magic-numbers 2>&1); then
  ERRORS="${ERRORS}magic-numbers failed; "
  DETAILS="${DETAILS}magic-numbers: FAILED\n"
else
  DETAILS="${DETAILS}magic-numbers: passed\n"
fi

# Architecture
if ! ARCH_OUT=$(pnpm check:architecture 2>&1); then
  ERRORS="${ERRORS}architecture failed; "
  DETAILS="${DETAILS}architecture: FAILED\n"
else
  DETAILS="${DETAILS}architecture: passed\n"
fi

# Unit tests
if ! TEST_OUT=$(pnpm test:unit 2>&1); then
  ERRORS="${ERRORS}tests failed; "
  TEST_SUMMARY=$(echo "$TEST_OUT" | grep "Tests" | tail -1)
  DETAILS="${DETAILS}tests: FAILED — ${TEST_SUMMARY}\n"
else
  TEST_SUMMARY=$(echo "$TEST_OUT" | grep "Tests" | tail -1)
  DETAILS="${DETAILS}tests: ${TEST_SUMMARY}\n"
fi

if [ -n "$ERRORS" ]; then
  printf '{"hookSpecificOutput": {"hookEventName": "Stop", "additionalContext": "Quality gates FAILED: %s\\n%b"}}' "$ERRORS" "$DETAILS"
else
  printf '{"hookSpecificOutput": {"hookEventName": "Stop", "additionalContext": "Quality gates passed: format, lint, typecheck, pattern-style, decision-size, magic-numbers, architecture, tests — all green.\\n%b"}}' "$DETAILS"
fi
