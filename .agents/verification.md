# OpenWaggle Verification Matrix

Run the narrowest meaningful checks first, then broaden before handoff.

## Baseline Static Checks

```bash
pnpm typecheck
pnpm lint
pnpm check
```

`pnpm check` runs typecheck plus lint. Lint runs Biome, ESLint architecture/style rules, and instruction-reference checks.

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
npx -y react-doctor@latest . --verbose --diff main
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

Use quick E2E only when the built app is already current or the test intentionally avoids a full rebuild.

## Release Work

For publishable package work, `pnpm check` should include package import-boundary checks and package API snapshot checks. Snapshot drift must be fixed by either correcting the public API change or intentionally updating the committed package API snapshot in the same PR.

Load `.agents/skills/release/SKILL.md` before release/version/update-track work.

Before publishing a release, verify from the exact CI artifacts whenever possible. Post-publish installer checks are too late to prevent shipping broken installers.
