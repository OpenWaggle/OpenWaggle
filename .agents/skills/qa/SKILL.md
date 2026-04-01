---
name: qa
description: Full QA pass for OpenWaggle using Electron MCP tools. This skill should be used after completing implementation work to verify the feature works in the real Electron app. Runs automated checks, interacts with the UI, and reports results. Requires `pnpm dev:debug` to be running.
---

# QA

Automated QA workflow for validating OpenWaggle features in the real Electron app via Chrome DevTools MCP.

## When to Use

- After completing any implementation task that touches renderer, preload, or IPC code
- When the user invokes `/QA`
- As the final verification step before presenting changes for review

## Prerequisites

The app must be running with CDP enabled. If not already running, start it:

```bash
pnpm dev:debug
```

Wait ~10 seconds for the app to initialize, then proceed.

## QA Workflow

Execute these phases in order. Report each phase's result immediately — do not batch.

### Phase 1: Connection Verification

1. `mcp__electron-devtools__list_pages` — confirm the app is running and a page is selected
2. `mcp__electron-devtools__evaluate_script` with:
   ```js
   () => ({
     hasApi: typeof window.api !== 'undefined',
     isElectron: navigator.userAgent.includes('Electron'),
     apiMethods: typeof window.api !== 'undefined' ? Object.keys(window.api).length : 0,
   })
   ```
   Expect: `hasApi: true`, `isElectron: true`, `apiMethods > 0`

If connection fails, instruct the user to run `pnpm dev:debug` and retry.

### Phase 2: Visual Baseline

1. `mcp__electron-devtools__take_screenshot` — capture initial state
2. `mcp__electron-devtools__list_console_messages` with `types: ["error"]` — check for startup errors
3. Report any errors found. Filter out known non-issues:
   - `DIPS SQLite database` warning (Chromium internal, harmless)
   - `React DevTools` suggestion (dev-only)

### Phase 3: Feature-Specific Testing

Based on the changes made in the current session, test the specific feature:

1. `mcp__electron-devtools__take_snapshot` — get element UIDs
2. Interact with the feature using `click`, `type_text`, `press_key`, `fill` via UIDs
3. `mcp__electron-devtools__take_screenshot` after each significant interaction
4. Verify state changes via `evaluate_script` when visual verification is insufficient

**Interaction pattern:**
- Always `take_snapshot` before interacting — UIDs change after navigation/reload
- For text input: `click` the input element first, then `type_text`
- For keyboard shortcuts: use `press_key` with modifiers (e.g., `Meta+K`)
- After navigation or page changes: take a fresh `take_snapshot`

### Phase 4: Regression Check

1. `mcp__electron-devtools__list_console_messages` with `types: ["error"]` — verify no new errors
2. `mcp__electron-devtools__evaluate_script` — verify `window.api` is still intact:
   ```js
   () => ({
     hasApi: typeof window.api !== 'undefined',
     respondToPlan: typeof window.api?.respondToPlan === 'function',
     answerQuestion: typeof window.api?.answerQuestion === 'function',
     sendMessage: typeof window.api?.sendMessage === 'function',
   })
   ```

### Phase 5: Database Verification (when persistence is involved)

If the feature involves persistence, verify data in SQLite:

```bash
DB_PATH="$HOME/Library/Application Support/openwaggle/openwaggle.db"
sqlite3 "$DB_PATH" "<query>"
```

Common queries:
- Recent conversations: `SELECT id, title, COUNT(m.id) FROM conversations c LEFT JOIN conversation_messages m ON m.conversation_id = c.id GROUP BY c.id ORDER BY c.updated_at DESC LIMIT 5;`
- Message parts for a conversation: `SELECT m.role, p.part_type FROM conversation_messages m JOIN conversation_message_parts p ON p.message_id = m.id WHERE m.conversation_id = '<id>' ORDER BY m.position, p.position;`

### Phase 6: Report

Produce a summary table:

```markdown
| Test | Result | Notes |
|------|--------|-------|
| App connection | PASS/FAIL | |
| API bridge intact | PASS/FAIL | |
| Feature renders | PASS/FAIL | |
| Feature interaction | PASS/FAIL | |
| No console errors | PASS/FAIL | |
| Database state | PASS/FAIL/N/A | |
```

If any test fails, include:
- The exact error or unexpected behavior
- A screenshot showing the issue
- The expected vs actual result

## Tips

- For plan mode testing: click the Plan button (look for "Plan" in snapshot), type a prompt, click send, wait for PlanCard
- For streaming tests: use `sleep` between interactions to allow streaming to complete
- To reload the page: `mcp__electron-devtools__navigate_page` with `type: "reload"` and `ignoreCache: true`
- To check React component state: use `evaluate_script` to traverse React fiber internals from DOM elements
- Load the `electron-qa` skill from `.openwaggle/skills/electron-qa/` for detailed MCP tool reference and feature-specific test recipes
