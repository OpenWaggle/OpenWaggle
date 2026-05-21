---
name: electron-qa
description: QA testing skill for OpenWaggle's Electron app using the configured Chrome DevTools MCP server. Use after renderer, preload, IPC, or interactive main-process changes to verify behavior in the real Electron app via CDP on port 9222.
---

# Electron QA

Verify OpenWaggle in the real Electron app through Chrome DevTools Protocol.

## When To Use

- Renderer changes under `src/renderer/`.
- Preload bridge changes under `src/preload/`.
- IPC changes under `src/main/ipc/`.
- Composer, chat, settings, sidebar, command palette, or other interactive UI changes.
- Visual or interaction regressions reported by users.

## Prerequisites

Start the app with CDP enabled:

```bash
pnpm dev:debug
```

Verify CDP is reachable:

```bash
curl -s http://127.0.0.1:9222/json/version
```

The configured MCP server is `electron-devtools` in `.mcp.json`.

## Minimum QA Checklist

1. `list_pages`: verify the Electron page is visible.
2. `evaluate_script`: confirm `window.api` exists and the user agent includes Electron.
3. `take_snapshot`: inspect the accessible structure and obtain UIDs.
4. `take_screenshot`: capture the current visual state.
5. Interact with the changed feature using `click`, `type_text`, `fill`, and `press_key`.
6. `list_console_messages` filtered to errors: verify no unexpected console errors.
7. Report the result with pass/fail rows and any gaps.

## Useful Evaluation

```js
() => ({
  hasApi: !!window.api,
  isElectron: navigator.userAgent.includes('Electron'),
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
| Electron page reachable | Pass/Fail | |
| window.api available | Pass/Fail | |
| Feature interaction | Pass/Fail | |
| Screenshot/snapshot reviewed | Pass/Fail | |
| Console errors checked | Pass/Fail | |
```

## Troubleshooting

- Empty pages list: app is not running or CDP port differs.
- `window.api` missing: connected to a non-Electron browser page or preload failed.
- Stale UIDs: take a fresh snapshot after navigation or re-render.
- Dev mode does not prove packaged behavior. Use packaged QA for packaged-only bugs.
