# OpenWaggle Verification Matrix

Run the narrowest meaningful checks first, then broaden before handoff.

## Pre-Push Baseline

```bash
pnpm verify
```

`pnpm verify` is the fast, deterministic pre-push contract: conventional-commit policy against the `origin/main` merge base, typecheck, lint, and unit tests. The husky pre-push hook runs it for every feature-branch push. Run it before pushing rather than discovering these failures from a red CI run.

## CI Gate Tiers

CI is tiered (ADR 0025). Per-push runs execute the Fast gate; the merge queue's merge result runs the Full gate:

- **Fast gate (per push):** Commit Policy, Typecheck & Lint, Unit Tests, Integration & Component Tests, MCP Conformance, Electron E2E (macOS, includes the Darwin visual baselines).
- **Full gate (merge queue result):** everything above plus Electron E2E (Linux), Electron E2E (Windows), and the package rehearsals when the merged diff touches package or website/docs surfaces.

Red jobs on a PR branch are the Fast gate; a red Windows or Linux E2E job on `main` or a queue run is the Full gate.

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

Then load `.agents/skills/electron-qa/SKILL.md` and verify through the real Electron app on CDP port 9222:

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

## E2E

```bash
pnpm test:e2e:headless
pnpm test:e2e:headless:quick
```

Use quick E2E only when the built app is current or the test intentionally avoids a full rebuild. Every `*:quick` E2E script verifies `out/` build provenance against the current HEAD and refuses a stale build ("run `pnpm test:e2e` to rebuild first"): a rebase or pull that moved HEAD invalidates the previous build even though `out/` still exists. E2E runs with one worker locally; CI runs two (`PLAYWRIGHT_WORKERS`) and retries each test twice on flaky assertions, capturing a Playwright report plus traces on retry.

### Visual Baselines

The six primary-surface baselines in `e2e/visual-regression.e2e.test.ts-snapshots/` are native Darwin images generated on the `macos-15` CI runner image; local macOS rendering can differ by a small margin, so the runner is the source of truth. When a change intentionally moves rendered pixels:

1. Update the snapshots: `pnpm test:e2e -- --update-snapshots` (or run `e2e/visual-regression.e2e.test.ts` only) and review the diff.
2. Push and let the Fast gate's macOS E2E verify on the runner image.
3. For a fast visual-only check on an exact commit, dispatch the CI workflow with the `visual` tier (`gh workflow run ci.yml -f head_sha=<sha> -f ci_tier=visual`).

Do not hand-edit baseline PNGs or loosen `maxDiffPixelRatio` to make a baseline check pass.

## Release Work

For publishable package work, `pnpm check` should include package import-boundary checks and package API snapshot checks. Snapshot drift must be fixed by either correcting the public API change or intentionally updating the committed package API snapshot in the same PR.

Load `.agents/skills/release/SKILL.md` before release/version/update-track work.

Before publishing a release, verify from the exact CI artifacts whenever possible. Post-publish installer checks are too late to prevent shipping broken installers.
