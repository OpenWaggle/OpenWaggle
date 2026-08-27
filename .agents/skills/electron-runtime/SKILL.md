---
name: electron-runtime
description: OpenWaggle Electron runtime guidance for child-process environment safety, native addon rebuilds, packaged app differences, CDP startup, and Electron-specific debugging. Use when Electron startup, packaging, native modules, child processes, environment variables, or Playwright Electron behavior are involved.
---

# Electron Runtime

Separate Node test behavior, Electron dev behavior, and packaged Electron behavior. They can fail differently.

## Child Process Environment

- Do not access `process.env` directly outside `src/main/env.ts`.
- Use `getSafeChildEnv()` for user commands that should not inherit secrets.
- Use full or specialized env helpers only when a child process genuinely needs inherited variables.
- Do not spread `process.env` into APIs expecting `Record<string, string>`; undefined values and secrets leak through.
- For Pi package/resource loading that shells out to npm, use the adapter-controlled npm-compatible PATH helper.

## Native Addons

Use repo scripts before hand-built rebuild commands:

```bash
pnpm prepare:native:node
pnpm prepare:native:electron
```

- Vitest and Electron do not share a native ABI target.
- Native mismatch symptoms include `NODE_MODULE_VERSION`, invalid architecture, missing symbols, or startup failure before the first window.
- Check the installed Electron version, not system Node, when rebuilding for Electron.
- Keep `electron-builder install-app-deps`; do not rely on it alone when startup still loads a Node-ABI binary.

## Packaged App Gotchas

- Packaged apps may not inherit the user's shell PATH.
- Resources copied from `app.asar` may need `app.asar.unpacked` paths.
- `electron-updater` needs the transitive `ms` runtime dependency explicitly present with pnpm packaging.
- Validate packaged-only regressions against the rebuilt `.app`, not only `pnpm dev`.
- On Apple silicon, use arm64 output for local performance checks.

## Playwright And CDP

- `pnpm dev:debug` starts non-disruptive Electron automation with CDP on reserved port 9223. It fails before launch if that port is occupied. Use `pnpm dev:debug:headed` for visible QA on port 9222; `pnpm dev` remains visible for normal development.
- Hidden `pnpm dev:debug` uses an ephemeral user-data directory and disables the single-instance lock. It never reuses or focuses an existing OpenWaggle process and never mutates the normal development profile.
- The hidden launcher owns its Electron child, exclusive port lease, ephemeral profile, forwarded logs, signal handling, stale-dead-process metadata recovery, and profile cleanup.
- The managed CDP page must match the launcher's per-run identity; a free-port preflight alone does not prove ownership. Lease recovery and acquisition are process-serialized, and evidence failure must not skip process-tree cleanup.
- Apply non-disruptive automation mode to every scripted Electron launch, including E2E, CDP QA, startup measurement, and website screenshot capture. Only ordinary `pnpm dev` and explicitly headed commands may show the app.
- Playwright Electron E2E needs isolated user data and single-instance lock opt-out when another app instance is open.
- Agent-run E2E and QA must not show or focus an Electron window, open native OS dialogs, or launch external applications. Those automated paths fail closed when an interaction would expose OS UI. A visible app requires an explicit headed command.
- Enforce the automation policy in the Electron main process. Repository checks must reject unguarded window-show/focus, native-dialog, and external-application calls outside the centralized policy.
- Do not load trusted-main or Pi runtime extensions during non-disruptive automation. Electron's window constructor exports are non-configurable, so dynamic main-process extension code cannot be made subject to the repository's static hidden-window construction boundary. Keep non-executable Pi resources available.
- Playwright Electron can run an unpackaged runtime where `is.dev` is true but no Vite dev URL exists; protocol registration must handle that.
- CDP `setInputFiles` may not prove native file-path extraction; cover preload path extraction separately.

## Verification

For runtime issues, verify the failing runtime path directly:

```bash
pnpm prepare:native:electron
pnpm build
pnpm test:e2e:headless:quick
```

For UI-visible behavior, use `.agents/skills/electron-qa/SKILL.md`.
