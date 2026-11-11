---
name: electron-runtime
description: OpenWaggle desktop runtime guidance (Electrobun on Bun) for child-process environment safety, native addon builds, packaged app differences, CDP startup, and shell-specific debugging. Use when desktop startup, packaging, native modules, child processes, environment variables, or scripted app launches are involved.
---

# Desktop Runtime

The desktop app runs on Electrobun (ADR 0064): the main process is a Bun Worker inside the launcher's Bun process, the Session Host and the CLI are plain `bun` processes, and the main window is a system webview (CEF under automation). The skill keeps its old `electron-runtime` name. Separate Vitest behavior, dev-build behavior, and packaged behavior. They can fail differently.

## Child Process Environment

- Do not access `process.env` directly outside `src/main/env.ts`.
- Use `getSafeChildEnv()` for user commands that should not inherit secrets.
- Use full or specialized env helpers only when a child process genuinely needs inherited variables.
- Do not spread `process.env` into APIs expecting `Record<string, string>`; undefined values and secrets leak through.
- For Pi package/resource loading that shells out to npm, use the adapter-controlled npm-compatible PATH helper.

## Native Addons

Use the repo script before hand-built rebuild commands:

```bash
bun run prepare:native:node
```

- Bun loads Node-API addons built for Node's ABI, so one build (`better-sqlite3`, cached under `node_modules/.cache`) serves Vitest, the Session Host and the app.
- Native mismatch symptoms include `NODE_MODULE_VERSION`, invalid architecture, missing symbols, or startup failure before the first window.
- The packaged app ships only its own platform's and architecture's native builds (`scripts/electrobun/stage-node-modules.ts`); `bun run packaged-app:smoke` loads them with the app's bundled Bun.

## Packaged App Gotchas

- Packaged apps may not inherit the user's shell PATH.
- The app directory is `Contents/Resources/app` on macOS and `Resources/app` elsewhere, a plain directory: `out/{main,preload,renderer}`, the staged `node_modules`, `resources/` and `package.json`.
- The staged `node_modules` holds only what main loads from disk: the build's externals and the packages it resolves by path (`RUNTIME_RESOLVED_PACKAGES`). A package inside a checkout can resolve a missing one from the checkout's `node_modules`, so test packaging-only bugs on a copy outside it.
- Validate packaged-only regressions against the packaged `.app` (`bun run package:app`), not only `bun run dev`.
- On Apple silicon, use arm64 output for local performance checks.

## Playwright And CDP

- `bun run dev:debug` builds an Electrobun `dev` app and starts it hidden with CDP on port 9223 (`scripts/electrobun/dev.ts`); `bun run dev` shows the app for normal development.
- Every scripted launch goes through `scripts/support/electrobun-app-launch.ts`: `OPENWAGGLE_AUTOMATION=1`, scratch `HOME`, Pi agent and userData directories, the single-instance lock disabled, `OPENWAGGLE_QA_MAIN_WINDOW_RENDERER=cef` and `ELECTROBUN_CEF_REMOTE_DEBUGGING_PORT=<port>`. Playwright then attaches with `chromium.connectOverCDP` and takes the page whose URL ends in `/index.html`. The repository standards reject a script that sets those variables itself.
- A system webview has no DevTools endpoint; only the CEF renderer can be driven. Electrobun's main process is a Bun Worker without a Node inspector, so main-process state is read through the renderer, the app log or `OPENWAGGLE_*` inputs.
- CEF runs one process per cache directory, which Electrobun keeps under the app identifier in the OS app-data folder, not under `HOME`. A second launch of the same build hands its window to the running one and exits 0 (`Opening in existing browser session`).
- Agent-run QA must not show or focus a window, open native OS dialogs, or launch external applications. Those automated paths fail closed when an interaction would expose OS UI. A visible app requires an explicit headed run the maintainer approved.
- Enforce the automation policy in the main process. Repository checks reject unguarded window-show/focus, native-dialog, and external-application calls outside the centralized policy.
- Do not load trusted-main or Pi runtime extensions during non-disruptive automation. Keep non-executable Pi resources available.
- CDP `setInputFiles` may not prove native file-path extraction; cover preload path extraction separately.

## Verification

For runtime issues, verify the failing runtime path directly:

```bash
bun run prepare:native:node
bun run dev:debug   # then verify via .agents/skills/electron-qa/SKILL.md
```

For UI-visible behavior, use `.agents/skills/electron-qa/SKILL.md`.
