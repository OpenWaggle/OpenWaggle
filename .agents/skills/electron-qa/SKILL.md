---
name: electron-qa
description: QA testing skill for OpenWaggle's desktop app (Electrobun) using the configured Chrome DevTools MCP server. Use after renderer, preload, IPC, or interactive main-process changes to verify behavior in the real app via CDP on port 9223.
---

# Desktop App QA

Verify OpenWaggle in the real desktop app through the Chrome DevTools Protocol. The app runs on Electrobun (ADR 0064); the skill keeps its old `electron-qa` name.

## When To Use

- Renderer changes under `src/renderer/`.
- Preload bridge changes under `src/preload/`.
- IPC changes under `src/main/ipc/`.
- Composer, chat, settings, sidebar, command palette, or other interactive UI changes.
- Visual or interaction regressions reported by users.

## Prerequisites

Start the app with CDP enabled:

```bash
bun run dev:debug
```

It builds the checkout (`bun run build`), stages it, builds an Electrobun `dev` app with Hutch (`scripts/electrobun/dev.ts`) and starts it hidden: `OPENWAGGLE_AUTOMATION=1` keeps the window hidden and no OS UI appears, `OPENWAGGLE_QA_MAIN_WINDOW_RENDERER=cef` renders the main window with the bundled CEF instead of the system webview, and `ELECTROBUN_CEF_REMOTE_DEBUGGING_PORT=9223` opens CEF's DevTools endpoint there. A system webview has no CDP endpoint, so QA always sees the CEF renderer; a WebKit-only (macOS, Linux) rendering bug needs headed QA. `--skip-build` reuses the last build. Never run a visible `bun run dev` for QA unless the maintainer explicitly approves that exact run.

Scripts start the app the same way through `scripts/support/electrobun-app-launch.ts` (`launchElectrobunApp`: website screenshots, the perf harnesses, live Session QA); the repository standards reject a script that sets those variables itself. CEF runs one process per app identifier (its cache lives under `~/Library/Application Support/<identifier>/<env>/CEF` on macOS, not under `HOME`), so a launch while the same build already runs hands its window to that process and exits; quit the other copy first.

Every QA run, and every other start of the built app, Session Host, or `openwaggle` CLI, sets `HOME`, `PI_CODING_AGENT_DIR`, and `OPENWAGGLE_USER_DATA_DIR` to scratch directories and passes `--use-mock-keychain`; overriding userData alone still migrates the real `~/.openwaggle` and `~/.pi/agent` files and reaches the real keychain. `bun run dev:debug` does all of this itself: its ephemeral profile is a `openwaggle-dev-debug-*` directory under `TMPDIR` with `home/` and `user-data/`, and it adds `--password-store=basic` on Linux. The QA app therefore has none of your Pi sign-ins, `~/.gitconfig`, `gh` sign-ins, or SSH keys; use a fixture provider (below) instead of a real one. Any other launcher starts from `buildSafeAppEnvironment`, whose overrides win over the inherited `HOME`, and which forwards a caller's scratch `PI_CODING_AGENT_DIR`; `dev:debug` also forwards the caller's `OPENWAGGLE_AUTOMATION_*` options.

Automation starts no MCP server that a project MCP file (`.mcp.json`, `.pi/mcp.json`, `.openwaggle/mcp.json`) defines: this repository's `.mcp.json` would run `npx -y chrome-devtools-mcp@latest` against the QA app's own CDP port. Settings still lists those servers, and a Run or connection check reports that automation left them out. To QA project MCP servers, start the app with `OPENWAGGLE_AUTOMATION_PROJECT_MCP=1 bun run dev:debug`.

Stopping `bun run dev:debug` (Ctrl-C, `SIGTERM`, or the app exiting) also stops the app's detached Session Host: the script drains it through its version-handoff path and removes the profile only after the Host released it. A `session-host-internal` process that outlives the script is a bug.

The managed hidden profile selects the current worktree but contains no fabricated sessions. Seed only the deterministic fixture required by the feature under test.

Automation disables executable Pi extensions, which also hides OpenWaggle's first-party tools (such as `hive`) from the model. To QA those tools, start the app with `OPENWAGGLE_AUTOMATION_FIRST_PARTY_EXTENSIONS=1 bun run dev:debug`.

To give a QA run a fixture Pi extension, such as a faux provider or a virtual model, name its files in `OPENWAGGLE_AUTOMATION_PI_EXTENSIONS` (separated by the platform path delimiter, `:` on macOS and Linux), for example `OPENWAGGLE_AUTOMATION_PI_EXTENSIONS=$TMPDIR/qa-ext/qa-router.js bun run dev:debug`. Automation loads those files and no other discovered extensions. The variable is ignored outside automation (`OPENWAGGLE_AUTOMATION=1`), so it cannot load code into a normal app. Pi caches the extension module, so restart the QA app after editing a fixture. Keep fixtures outside the repository, for example in the session scratch directory.

A fake model for such a fixture is `fauxProvider` from `@earendil-works/pi-ai`, registered with `pi.registerProvider(faux.provider)`. Its scripted responses must find the user's prompt by content, not as the last user message: the Host adds its Run identity message after the prompt. Select the model under **Settings > Connections > Available Models** and set **Session titles** to **Off** first, or the background title request consumes a scripted response. A first send on the current checkout runs the launch step that fast-forward pulls the branch from its upstream (`session-branch-freshness.ts`), so QA on a branch that tracks a remote picks up its new commits.

Verify CDP is reachable:

```bash
curl -s http://127.0.0.1:9223/json/version
```

The configured MCP server is `electron-devtools` in `.mcp.json`.

## Minimum QA Checklist

1. `list_pages`: verify the app's `…/index.html` page is listed.
2. `evaluate_script`: confirm `window.api` exists.
3. `take_snapshot`: inspect the accessible structure and obtain UIDs.
4. `take_screenshot`: capture the current visual state.
5. Interact with the changed feature using `click`, `type_text`, `fill`, and `press_key`.
6. `list_console_messages` filtered to errors: verify no unexpected console errors.
7. Capture at least one representative final-state screenshot, plus additional states needed to prove the interaction.
8. Save QA evidence in `$OPENWAGGLE_EVIDENCE_DIR` when it is set (an OpenWaggle agent shell; it survives archiving, so a Queen can render a Worker's screenshots), otherwise under a run-specific directory in the OS temporary directory, never inside the repository. Intentional visual-regression baselines are separate test assets and do not count as QA evidence.
9. Render every evidence screenshot in the final user response using its absolute path.
10. Report the result with pass/fail rows and any gaps.

## Useful Evaluation

```js
() => ({
  hasApi: !!window.api,
  href: window.location.href,
})
```

## Feature Recipes

Composer:

- Click the contenteditable composer.
- Type normal text and submit.
- Type `/` for command behavior when relevant.
- Type `@` for mention behavior when relevant.
- Use `Shift+Enter` for newline behavior.
- Check that failed preload/API availability degrades visibly instead of crashing the composer.

Navigation:

- Use snapshot UIDs to select sidebar/header controls.
- Verify the route and visible panel changed.
- For hash routes, navigate to `http://localhost:5173/#/<route>` in dev-mode browser contexts.

IPC/preload:

- Evaluate `Object.keys(window.api)` for bridge availability.
- Exercise the specific method through UI when possible.
- Use direct evaluation only for narrow diagnostics.

## Reporting Template

```markdown
| Check | Result | Notes |
|---|---|---|
| App page reachable | Pass/Fail | |
| window.api available | Pass/Fail | |
| Feature interaction | Pass/Fail | |
| Screenshot/snapshot reviewed | Pass/Fail | |
| Console errors checked | Pass/Fail | |
```

After the table, render the evidence images. A path alone is not sufficient.

If hidden screenshot capture fails, report QA as incomplete and ask the maintainer for exact-run approval before using headed QA. Never treat screenshot failure as implicit headed permission.

## Troubleshooting

- Empty pages list: app is not running or CDP port differs.
- `window.api` missing: connected to another page (a Browser preview guest is a CEF target on the same endpoint) or the preload failed.
- `dev:debug` exits right after `Opening in existing browser session`: the same build already runs; quit it.
- Stale UIDs: take a fresh snapshot after navigation or re-render.
- Dev mode does not prove packaged behavior. Use packaged QA for packaged-only bugs.
