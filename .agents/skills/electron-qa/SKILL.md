---
name: electron-qa
description: QA testing skill for OpenWaggle's Electron app using Chrome DevTools MCP and electron-test-mcp. This skill should be used after implementing renderer, preload, or main process changes to verify behavior in the real Electron app via CDP on port 9222.
---

# Electron QA Testing

Procedures for testing OpenWaggle in the real Electron app using two MCP servers that connect via Chrome DevTools Protocol (CDP).

## When to Use

- After implementing any renderer code (`src/renderer/`)
- After modifying preload bridge (`src/preload/`)
- After changing IPC handlers (`src/main/ipc/`)
- After modifying the composer, chat, or any interactive UI component
- As part of Definition of Done verification (step 5)
- When debugging visual or interaction bugs reported by users

## Prerequisites

Start the Electron app with CDP enabled:

```bash
pnpm dev:debug
```

This launches Electron with `--remote-debugging-port=9222`. Verify CDP is active:

```bash
curl -s http://127.0.0.1:9222/json/version
```

## MCP Server Overview

Two MCP servers are configured in `.mcp.json`, both connecting to Electron on port 9222.

| Server | Strengths | Prefix |
|--------|-----------|--------|
| **electron-devtools** (primary) | Screenshots, a11y snapshots, UID-based interaction, console/network inspection, performance traces, Lighthouse | `mcp__electron-devtools__` |
| **electron-test** (supplementary) | Playwright CSS/text selectors, element queries, wait conditions | `mcp__electron-test__` |

**Default to `electron-devtools`** for all QA. Use `electron-test` when Playwright selectors are more natural.

## electron-devtools Tool Reference

| Tool | Purpose |
|------|---------|
| `list_pages` | List open Electron windows, verify app started |
| `take_screenshot` | Capture viewport or element by UID |
| `take_snapshot` | A11y tree with UIDs for element discovery |
| `evaluate_script` | Run JS in renderer (function syntax: `() => { return ... }`) |
| `click` | Click element by UID from snapshot |
| `type_text` | Type into focused input |
| `press_key` | Press key or combo (e.g., `Shift+Enter`, `Escape`, `Meta+K`) |
| `fill` | Fill input by UID |
| `navigate_page` | Navigate or reload |
| `list_console_messages` | Read console output, filter by type |
| `list_network_requests` | Inspect network/IPC activity |
| `hover` | Hover over element by UID |

**Interaction pattern:** `take_snapshot` to get UIDs, then `click`/`type_text`/`fill` using those UIDs.

**JS evaluation:** Uses function syntax with explicit return:
```js
evaluate_script: () => { return { hasApi: !!window.api } }
```

## electron-test Tool Reference

| Tool | Purpose |
|------|---------|
| `connect` | Connect to Electron via CDP — call with `port: 9222` first |
| `disconnect` | Detach from app |
| `screenshot` | Capture window |
| `snapshot` | A11y tree (Playwright format) |
| `click` | Click by CSS/text selector: `text=Submit`, `[data-testid="x"]` |
| `fill` | Fill input by selector |
| `type` | Type character by character (for triggers like `@`, `/`) |
| `press` | Press key combo |
| `evaluate` | Run JS in renderer (**expression syntax, no `return`**) |
| `wait` | Wait for element state (visible/hidden/attached) |
| `getText` | Get element text content |
| `getAttribute` | Get element attribute value |
| `isVisible` | Check element visibility |
| `count` | Count matching elements |

**Connection required:** Always call `connect({ port: 9222 })` before other tools.

**JS evaluation:** Uses expression syntax (no return keyword):
```js
evaluate: ({ hasApi: !!window.api, title: document.title })
```

**Limitation:** `evaluateMain` (main process JS) only works in launch mode, not CDP connect mode.

## Standard QA Procedure

Run through this checklist after completing implementation:

### 1. Start and Verify Connection

```
pnpm dev:debug
electron-devtools → list_pages  # Should show "OpenWaggle" page
electron-devtools → evaluate_script:
  () => ({ hasApi: !!window.api, isElectron: navigator.userAgent.includes('Electron') })
  # Must return { hasApi: true, isElectron: true }
```

### 2. Visual Verification

```
electron-devtools → take_screenshot   # Capture current state
electron-devtools → take_snapshot     # Verify DOM structure
```

### 3. Interaction Testing

Test the specific feature implemented. Interact via snapshot UIDs:

```
take_snapshot → find element UID → click/type_text/fill → take_screenshot
```

### 4. Error Check

```
electron-devtools → list_console_messages with types=["error"]
# Filter out expected IPC unavailable messages if testing in Chrome
```

### 5. Report Results

Summarize in a table:

```
| Test | Result |
|------|--------|
| Feature renders correctly | Pass/Fail |
| Interaction works | Pass/Fail |
| No console errors | Pass/Fail |
| State updates correctly | Pass/Fail |
```

## Feature-Specific Test Recipes

### Composer / Lexical Editor

```
click [contenteditable="true"]
type "@"                    → Verify mention dropdown appears (requires project selected)
type "/"                    → Verify command palette opens
type "https://example.com " → Verify URL auto-detected as mention node
press_key "Shift+Enter"     → Verify newline inserted
press_key "Enter"           → Verify message submitted
press_key "Escape"          → Verify dropdown/palette dismissed
```

### IPC / Preload Bridge

```
evaluate_script: () => Object.keys(window.api)           # List all methods
evaluate_script: () => Object.keys(window.api).length     # Count methods
evaluate_script: () => window.api.getSettings()           # Test specific IPC call
```

### Navigation / Sidebar

```
take_snapshot → click sidebar button UID → take_screenshot  # Verify navigation
```

## Choosing the Right Tool

| Need | Tool |
|------|------|
| Screenshot | `electron-devtools → take_screenshot` |
| Find elements | `electron-devtools → take_snapshot` (UID-based) |
| Click by UID | `electron-devtools → click` |
| Click by CSS/text | `electron-test → click("text=Submit")` |
| Type trigger chars (`@`, `/`) | `electron-test → type` (character-by-character) |
| Type full text | `electron-devtools → type_text` |
| Check console | `electron-devtools → list_console_messages` |
| Wait for element | `electron-test → wait` |
| Count elements | `electron-test → count` |
| Get text content | `electron-test → getText` |
| Performance | `electron-devtools → performance_start_trace` |

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `list_pages` returns empty | App not running. Run `pnpm dev:debug` |
| `window.api` undefined | Connected to Chrome, not Electron. Check `navigator.userAgent` for "Electron" |
| `evaluateMain` not available | Expected — only works in electron-test launch mode, not CDP |
| Stale UIDs | Take fresh `take_snapshot` after any navigation or reload |
| Console flooded with IPC errors | Normal in Chrome browser. Use `pnpm dev:debug` for full Electron |
