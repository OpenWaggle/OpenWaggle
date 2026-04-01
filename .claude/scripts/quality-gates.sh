#!/usr/bin/env bash
# Quality gates hook — runs format, lint, typecheck, and tests after implementation.
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
  printf '{"hookSpecificOutput": {"hookEventName": "Stop", "additionalContext": "Quality gates passed: format, lint, typecheck, tests all green.\\n%b"}}' "$DETAILS"
fi
