# OpenWaggle Verification Matrix

Run the narrowest meaningful checks first, then broaden before handoff.

## Pre-Push Baseline

```bash
pnpm verify
```

`pnpm verify` is the fast, deterministic pre-push contract: conventional-commit policy against the `origin/main` merge base, typecheck, lint, and unit tests. The husky pre-push hook runs it for every feature-branch push. Run it before pushing rather than discovering these failures from a red CI run.

## CI Gate Tiers

CI is not tiered behind a merge queue (ADR 0033 refines ADR 0029). Pull requests and pushes to `main` run the same gate; there is no Electron E2E and no merge queue:

- **Per-PR / per-push gate:** Commit Policy, Typecheck & Lint, Unit Tests, Integration & Component Tests, MCP Conformance, plus the always-present Package Release Gate that aggregates them.
- **Session Performance workflow (manual/dispatch):** `pnpm benchmark:session-release` validates the packaged embedding model's warm query latency and multilingual recall, the exact 100,000-Session vector index, and the 100,000-Session/10,000,000-message reference corpus. `pnpm benchmark:session-performance` remains the faster local 1,000,000-message development check.
- **Nightly canary (non-gating):** `.github/workflows/nightly.yml` builds and runs `packaged-app:smoke` on macOS/Linux/Windows, and runs the syntax performance benchmark on macOS. It never blocks a merge.

Pushes to `main` run the same checks as a PR (the path-scoped `changes` job is skipped on push, which the gate tolerates).

### Windows native diagnostics

Normal native preparation probes the same automatic backend selection as the app,
plus bundled ConPTY. It retains the full identity, I/O, containment, resource-drain,
and exact 256 KiB final-output checks. It does not force legacy WinPTY on modern
Windows. If an older host selects WinPTY and loses output, preparation still fails.

The manual `windows-terminal-diagnostics.yml` workflow accepts an exact `head_sha`,
`runtime` (`electron` or `node`), and `profile` (`runtime` or `all-backends`). It runs
only native preparation/probes, caches the Windows pnpm store, and retains diagnostic
logs. `all-backends` forces system ConPTY, bundled ConPTY, and WinPTY through the same
assertions. WinPTY currently fails the burst check because its 3,000-row console
screen buffer loses the beginning before scraping. Do not treat a green runtime
profile as proof of lossless WinPTY support.

This follows T3 Code's separation of ordinary CI from manual Windows investigation,
and its test strategy: OpenWaggle no longer runs Electron E2E in CI at all
(ADR 0033), relying on unit + integration + MCP conformance, with the manual
Windows diagnostics workflow for native investigation. The reference is T3 Code commit
`b1e223e2b0d87124883b1410ab52dd6a1338e40d`, specifically
`apps/server/src/terminal/NodePtyAdapter.ts` and `.github/workflows/windows-tests.yml`.

## Baseline Static Checks

```bash
pnpm typecheck
pnpm lint
pnpm check
```

`pnpm check` runs typecheck plus the full static verification (installer script, contrast, test typecheck, lint, package release validation, API snapshots, package docs, package smoke). Lint runs Biome, ESLint architecture/style rules, and instruction-reference checks.

## Targeted Tests

```bash
pnpm test:unit
pnpm test:integration
pnpm test:component
pnpm test
pnpm test:coverage
```

Use targeted Vitest file runs while iterating, then run the relevant script before handoff.

## Renderer Work

For any `src/renderer/` change:

```bash
pnpm lint
pnpm test:component
npx -y react-doctor@latest . --verbose --scope changed --base main
```

Fix React Doctor errors. Warnings require judgment and should be reported if not fixed.

## Electron / IPC / Preload Work

For renderer interaction, preload, IPC, or main-process behavior that affects the UI:

```bash
pnpm dev:debug
```

Then load `.agents/skills/electron-qa/SKILL.md` and verify through the real Electron app on CDP port 9223:

- app page is reachable
- `window.api` exists
- target interaction works
- screenshot or DOM snapshot confirms behavior
- console errors are checked

## Pi Runtime Work

For Pi adapter, provider/auth/model, MCP, resource loading, session projection, compaction, active-run, or tool-event changes:

```bash
pnpm test:unit
pnpm test:integration
pnpm check
```

Also load `.agents/skills/pi-integration/SKILL.md` and run targeted tests around the touched adapter/projection/service.

## Native / Packaged Electron Work

For native modules or packaged-only regressions:

```bash
pnpm prepare:native:node
pnpm prepare:native:electron
pnpm build
pnpm build:mac
```

Packaged regressions require packaged-app QA, not only dev-mode validation.

## Packaged app validation

There is no Electron E2E suite (ADR 0033). Per-PR gating relies on unit + integration + component + MCP conformance. For the real packaged app:

```bash
pnpm build                      # production bundle
pnpm packaged-app:smoke         # asar shape + native (node-pty/sqlite) load probe
```

The nightly canary (`.github/workflows/nightly.yml`) runs this build + smoke on macOS/Linux/Windows as a non-gating signal. For UI-visible behavior use `pnpm dev:debug` with `.agents/skills/electron-qa/SKILL.md`. Renderer boot, CSP, visual pixels, and timing budgets are no longer checked in CI — validate them locally/manually when the change touches them.
## Release Work

For publishable package work, `pnpm check` should include package import-boundary checks and package API snapshot checks. Snapshot drift must be fixed by either correcting the public API change or intentionally updating the committed package API snapshot in the same PR.

Load `.agents/skills/release/SKILL.md` before release/version/update-track work.

Before publishing a release, verify from the exact CI artifacts whenever possible. Post-publish installer checks are too late to prevent shipping broken installers.
