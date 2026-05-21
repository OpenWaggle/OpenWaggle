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

- `pnpm dev:debug` starts Electron with CDP on port 9222.
- Playwright Electron E2E needs isolated user data and single-instance lock opt-out when another app instance is open.
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
