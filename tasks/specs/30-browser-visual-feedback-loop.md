# 30 — Browser-Aware Visual Feedback Loop

**Status:** Planned
**Priority:** P3
**Category:** Feature
**Depends on:** None (Playwright already in deps)
**Origin:** Spec 13

---

## Goal

Give the agent the ability to see, evaluate, and iterate on running UI by integrating Playwright-based browser automation. The agent writes code, screenshots the result, evaluates it visually, and self-corrects — all running locally against the user's actual dev server.

## Architecture

```
1. Agent writes/edits code
2. Agent invokes visualFeedback tool
3. Tool detects or starts dev server
4. Playwright navigates to dev server URL
5. Waits for HMR/page load to settle
6. Takes screenshot + captures console errors
7. Returns screenshot (base64) + errors to agent context
8. Agent evaluates visually via multimodal LLM
9. If issues found → edit code → goto step 2
10. If satisfied → report completion with before/after screenshots
```

## Implementation

### Phase 1: Visual Feedback Tool
- [ ] Install `playwright-core` (no bundled browsers, ~3MB)
- [ ] Create `src/main/tools/tools/visual-feedback.ts`
- [ ] Create `src/main/tools/browser-manager.ts` — Chromium lifecycle
- [ ] Create `src/main/tools/dev-server-detector.ts` — probe common ports

### Phase 2: Console & Network Capture
- [ ] Capture `console.error`, `console.warn`, network failures

### Phase 3: Dev Server Management
- [ ] Create `startDevServer` tool (`needsApproval: true`)

### Phase 4: Multi-Viewport & Responsive Testing
- [ ] Viewport presets: desktop, tablet, mobile

### Phase 5: Cross-Agent Visual Review (integrates with multi-agent)
- [ ] Agent A writes UI code, Agent B uses `visualFeedback` to review

## Security Constraints

- Browser navigates to localhost only
- No cookies, no session storage, no saved credentials
- Browser runs in incognito/isolated context
- Screenshots are base64 in memory, not written to disk

## Files to Create

- `src/main/tools/tools/visual-feedback.ts`
- `src/main/tools/browser-manager.ts`
- `src/main/tools/dev-server-detector.ts`

## Files to Modify

- `src/main/tools/index.ts` — register new tool
- `package.json` — add `playwright-core`

## Review Notes (2026-02-25, codebase audit)

**Dependency bloat warning:** The full `playwright` package (v1.58.2, ~100MB+ with browser
binaries) is currently in `dependencies` (not `devDependencies`). This ships in every
install despite the feature being Planned and unimplemented.

Phase 1 already correctly specifies `playwright-core` (~3MB, no bundled browsers) as the
target. Immediate action: **move `playwright` from `dependencies` to `devDependencies`
now**, and only add `playwright-core` when this spec is actively worked on. The current
state adds massive install footprint for zero user value.

The `src/main/tools/tools/browser/session.ts` does `import('playwright')` dynamically,
so moving it to devDependencies won't break the build — the import will simply fail at
runtime if someone tries to use the unfinished browser tools, which is the correct
behavior for an unimplemented feature.
