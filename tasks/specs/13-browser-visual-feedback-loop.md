# Spec 13 — Browser-Aware Visual Feedback Loop

**Goal**: Give the agent the ability to see, evaluate, and iterate on running UI by integrating Playwright-based browser automation. The agent writes code, screenshots the result, evaluates it visually, and self-corrects — all running locally against the user's actual dev server.

**Status**: Planned

**Depends on**: None (Playwright already in `package.json` dependencies)

---

## The Gap

No desktop-native coding agent provides an autonomous visual feedback loop.

| Tool | Browser Capability | Autonomous Loop? |
|------|-------------------|-----------------|
| Devin | Cloud sandbox browser | Partial — screenshots for PR proof, not primary feedback |
| Bolt.new / Lovable / v0 | WebContainer preview | No — human is the visual feedback loop |
| Claude Code | Chrome extension (`--chrome`) | Partial — requires Chrome ext setup, CLI only |
| Cursor / Windsurf | Via MCP servers | No — tools available but no autonomous loop |
| Chrome DevTools MCP | 26 tools via CDP | Tools exist, no agent-driven iteration |

**The novel combination**: Desktop-native agent that autonomously writes code, sees the result via Playwright, evaluates it with multimodal LLM, and iterates — against the user's real codebase and dev server, not a sandbox.

---

## Architecture

### Flow

```
1. Agent writes/edits code (writeFile, editFile tools)
2. Agent invokes visualFeedback tool
3. Tool detects or starts dev server (Vite, Next.js, etc.)
4. Playwright navigates to dev server URL
5. Waits for HMR/page load to settle
6. Takes screenshot + captures console errors
7. Returns screenshot (base64) + errors to agent context
8. Agent evaluates visually via multimodal LLM
9. If issues found → edit code → goto step 2
10. If satisfied → report completion with before/after screenshots
```

### Browser Lifecycle

- **On-demand**: Launch Chromium only when `visualFeedback` tool is invoked
- **Pooled**: Keep browser alive for the duration of a visual iteration loop (multiple screenshot cycles)
- **Cleanup**: Close browser after iteration completes or after 2-minute idle timeout
- **Never persistent**: No background browser process when not actively iterating

### Dev Server Detection

```
1. Check common ports: 3000, 3001, 5173, 5174, 8080, 4200
2. Parse package.json for dev script patterns (vite, next dev, etc.)
3. If no server running and user confirms, start dev server as child process
4. Wait for server ready (port probe + health check)
```

---

## Implementation

### Phase 1: Visual Feedback Tool

- [ ] Install `playwright-core` as dependency (not `playwright` — no bundled browsers)
  - Use system Chrome/Chromium for initial implementation
  - `playwright-core` is ~3MB, no browser download
- [ ] Create `src/main/tools/tools/visual-feedback.ts`
  - Tool name: `visualFeedback`
  - Zod schema for args:
    - `url?: string` — specific URL to screenshot (default: auto-detect dev server)
    - `selector?: string` — CSS selector to screenshot specific element
    - `viewport?: { width: number; height: number }` — viewport size (default: 1280x720)
    - `waitFor?: 'networkidle' | 'domcontentloaded' | 'load'` — wait strategy
    - `fullPage?: boolean` — full page vs viewport screenshot
  - Returns: `{ screenshot: string (base64), consoleErrors: string[], consoleWarnings: string[], url: string, viewport: { width, height } }`
  - `needsApproval: false` (read-only operation — just screenshots)
- [ ] Create `src/main/tools/browser-manager.ts`
  - `BrowserManager` class — manages Chromium lifecycle
  - `ensureBrowser()` — launch if not running, return existing if alive
  - `closeBrowser()` — graceful shutdown
  - `getPage(url)` — navigate and wait
  - Uses `playwright-core` with `chromium.launch({ headless: true })`
  - Detects system Chrome via common install paths per platform
  - Idle timeout: close browser after 2 minutes of no tool calls
- [ ] Create `src/main/tools/dev-server-detector.ts`
  - `detectDevServer(projectPath)` — probe common ports, parse package.json
  - Returns `{ url: string, framework: string, isRunning: boolean }`
  - Does NOT auto-start servers (approval needed for that)
- [ ] Register `visualFeedback` tool in `src/main/tools/index.ts`

### Phase 2: Console & Network Capture

- [ ] Extend visual feedback tool to capture:
  - `console.error` and `console.warn` messages during page load
  - Unhandled promise rejections
  - Network request failures (4xx, 5xx responses)
  - JavaScript runtime errors
- [ ] Return structured error data alongside screenshot
  - Agent can decide: visual issue, runtime error, or both

### Phase 3: Dev Server Management

- [ ] Create `startDevServer` tool (separate from `visualFeedback`)
  - `needsApproval: true` (starts a process)
  - Detects framework from package.json
  - Starts dev server as managed child process
  - Tracks running dev servers per project
  - Cleanup on conversation end or app quit
- [ ] Add dev server status to `ToolContext`
  - Other tools can check if a dev server is running

### Phase 4: Multi-Viewport & Responsive Testing

- [ ] Add viewport presets: desktop (1280x720), tablet (768x1024), mobile (375x812)
- [ ] `visualFeedback` accepts `viewports: string[]` to screenshot multiple sizes in one call
- [ ] Agent can evaluate responsive behavior across breakpoints

### Phase 5: Cross-Agent Visual Review (integrates with Spec 15)

- [ ] In multi-agent mode: Agent A writes UI code, Agent B uses `visualFeedback` to review
- [ ] Agent B screenshots and evaluates, provides visual critique to Agent A
- [ ] The "design review" workflow: user provides mockup/screenshot, Agent A implements, Agent B compares

---

## Resource Budget

| Component | Memory | CPU | Disk |
|-----------|--------|-----|------|
| Headless Chromium | 300-600MB | Spikes during load | 0 (system Chrome) |
| Page rendering | 50-200MB | Moderate | 0 |
| **Total during loop** | **350-800MB** | **Moderate** | **0** |

Manageable on dev machines (16-32GB RAM standard). Chromium is launched on-demand and killed after the loop.

---

## Security Constraints

- Browser navigates to **localhost only** — no external URLs from agent-spawned browser
- No cookies, no session storage, no saved credentials in agent browser
- Browser runs in incognito/isolated context
- Screenshots are base64 in memory — not written to disk unless user requests

---

## Files to Create

- `src/main/tools/tools/visual-feedback.ts` — the agent tool
- `src/main/tools/browser-manager.ts` — Chromium lifecycle management
- `src/main/tools/dev-server-detector.ts` — dev server detection

## Files to Modify

- `src/main/tools/index.ts` — register new tool
- `package.json` — add `playwright-core` dependency (replace or complement existing `playwright`)

---

## The Killer Demo

1. User provides a Figma screenshot or says "build me a dashboard with a sidebar, header, and chart area"
2. Agent writes React component
3. Agent invokes `visualFeedback` — sees the result
4. Agent notices: "The sidebar is overlapping the main content. The chart area has no padding."
5. Agent edits the code
6. Agent screenshots again — "Better. But the header height doesn't match the sidebar. Let me adjust."
7. Agent iterates 2-3 times
8. Final result: polished layout matching the intent, with before/after screenshots in the conversation

No human intervention mid-loop. The agent is its own QA.

---

## Verification

- [ ] `visualFeedback` tool takes screenshot of running Vite dev server
- [ ] Console errors are captured and returned alongside screenshot
- [ ] Agent can iterate on UI code using screenshot feedback (end-to-end loop)
- [ ] Browser is properly cleaned up after tool use (no zombie processes)
- [ ] System Chrome detected correctly on macOS, Windows, Linux
- [ ] Dev server detector finds running servers on common ports
- [ ] Memory stays within budget during visual loops
- [ ] Only localhost URLs are navigable (security constraint enforced)
