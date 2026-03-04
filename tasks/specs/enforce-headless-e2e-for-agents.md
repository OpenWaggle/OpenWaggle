# Enforce Headless E2E Runs for Agent Workflows

## Goal

Ensure E2E test runs triggered by agents are headless by default while preserving headed runs for manual local debugging.

## Checklist

- [x] Keep default `use.headless = true`.
- [x] Keep agent paths headless (`test:all` -> `test:e2e:headless`, `test:e2e` -> `test:e2e:headless`).
- [x] Add explicit manual headed command (`pnpm test:e2e:headed`).
- [x] Update AGENTS command guidance for headless-agent + headed-manual split.
- [x] Run verification (`pnpm lint`, `pnpm exec playwright test --list`, `pnpm exec playwright test --headed --list`).

## Notes

- Agent enforcement is done via script defaults/documented workflow, not by globally blocking `--headed`.

## Review

- `pnpm lint` passes.
- `pnpm exec playwright test --list` passes.
- `pnpm exec playwright test --headed --list` passes.
