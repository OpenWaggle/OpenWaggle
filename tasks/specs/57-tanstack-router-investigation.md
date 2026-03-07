# 57 — TanStack Router Investigation

**Status:** Not Started
**Priority:** P2
**Category:** Investigation / Evaluation
**Depends on:** None
**Origin:** T3Code competitive analysis — t3code uses TanStack Router for file-based routing in their Electron wrapper. User requested deep investigation into whether it fits OpenWaggle. Reference: [t3code](https://github.com/pingdotgg/t3code) TanStack Router usage with `createFileRoute` and Zod search params.

---

## Problem

OpenWaggle currently has no routing library. View state is managed via Zustand:

```typescript
// Current approach in App.tsx (simplified)
const activeView = useUIStore(s => s.activeView) // 'chat' | 'skills' | 'mcps' | 'settings'

// Simple conditional rendering
{activeView === 'chat' && <ChatPanel />}
{activeView === 'settings' && <SettingsPage />}
// etc.
```

This works for the current 4-view app but has limitations:
- **No URL-based navigation** — Cannot deep-link to a specific view or conversation
- **State lost on refresh** — Electron window reload resets to default view
- **No code splitting** — All views loaded upfront regardless of which is active
- **No search params** — Cannot encode view state (e.g., selected settings tab, conversation ID) in a URL
- **No navigation history** — No back/forward button support within the app

t3code uses TanStack Router despite being an Electron app because their architecture is web-first (browser + Electron). The router gives them type-safe routes, search param validation, route-level code splitting, and nested layouts.

**This is an investigation spec.** The deliverable is a documented recommendation (adopt / defer / reject) with supporting evidence, NOT an implementation.

## Investigation Tasks

### Task 1: Analyze t3code's Routing Usage

- [ ] Document t3code's route tree structure:
  - What routes exist? (e.g., `/`, `/project/$projectId`, `/project/$projectId/thread/$threadId`)
  - How are route params used? What Zod schemas validate search params?
  - How does the Electron wrapper interact with the router? (Does it use `createMemoryHistory` or `createBrowserHistory`?)
  - What features would break without the router? Which could be done with Zustand?
- [ ] Identify which TanStack Router features t3code actually uses:
  - Type-safe route definitions ✓/✗
  - Search params with Zod validation ✓/✗
  - Route-level code splitting (lazy routes) ✓/✗
  - Nested layouts with outlets ✓/✗
  - Route loaders (data prefetching) ✓/✗
  - Route guards / beforeLoad ✓/✗
  - Devtools ✓/✗

### Task 2: Evaluate Benefits for OpenWaggle

- [ ] **Type-safe navigation:**
  - Current Zustand approach: `useUIStore.getState().setActiveView('chat')` — already type-safe via union type
  - Router alternative: `navigate({ to: '/chat/$conversationId', params: { conversationId } })` — adds param validation
  - Assessment: Does the router add meaningful type safety beyond what we already have?

- [ ] **Code splitting:**
  - Measure current renderer bundle size: `pnpm build && du -sh out/renderer/`
  - Identify largest chunks: Settings, Chat, Skills, MCP pages
  - Estimate savings from route-level lazy loading
  - Assessment: Is the initial bundle large enough to justify splitting? (Electron loads from disk, not network)

- [ ] **Search params:**
  - Identify current view state that could benefit from URL encoding:
    - Active conversation ID
    - Settings tab selection
    - Diff panel open/closed state
    - Command palette state
  - Assessment: Would URL-encoded state improve UX? (No URL bar in Electron — state only useful for refresh persistence and deep linking)

- [ ] **Deep linking (`openwaggle://` protocol):**
  - Could enable: open specific conversation from terminal, link from notifications, link from external tools
  - `openwaggle://conversation/abc123` → opens app at that conversation
  - Requires Electron protocol handler registration + router integration
  - Assessment: How valuable is this feature? How much does the router help vs. manual protocol handling?

- [ ] **Multi-window support:**
  - If we add multi-window (e.g., detach conversation into new window):
    - Each window needs independent routing state
    - Router with `createMemoryHistory` per window handles this naturally
    - Without router: duplicated Zustand stores per window
  - Assessment: Is multi-window on the roadmap? If not, this is speculative value.

- [ ] **State persistence across refresh:**
  - Current: Zustand state lost on window reload; user starts at default view
  - Router with `createMemoryHistory`: state persists in memory (still lost on reload unless serialized)
  - Router with `createHashHistory`: state in URL hash, survives reload
  - Alternative without router: Zustand `persist` middleware with `sessionStorage`
  - Assessment: Which approach is simpler for the persistence goal?

### Task 3: Evaluate Costs

- [ ] **Bundle size impact:**
  - `@tanstack/react-router` — measure installed size
  - `@tanstack/router-devtools` — optional, development only
  - `@tanstack/router-vite-plugin` — build-time only
  - Compare to current zero-router overhead

- [ ] **Migration effort:**
  - Audit all navigation patterns in renderer (every `setActiveView`, conditional render, view switching)
  - Estimate component restructuring needed:
    - `App.tsx` → route provider + layout
    - Each view → route component
    - Navigation calls → `useNavigate()` or `<Link>`
  - Estimate: hours of work, risk of regression, number of files touched

- [ ] **Complexity assessment:**
  - For a single-window Electron app with ~6 views, is a router over-engineering?
  - Does the router concept map well to Electron, or does it introduce browser-centric abstractions that don't apply?
  - How does the router interact with our Zustand stores? Conflict or complement?
  - Will new team members find the routing pattern intuitive or confusing in an Electron context?

- [ ] **Electron-specific concerns:**
  - No address bar → URL is invisible to users
  - No browser back/forward buttons → need custom navigation UI or it's wasted
  - `BrowserWindow.loadFile()` or `loadURL()` → what history adapter works?
  - CSP restrictions on navigation?

### Task 4: Prototype (Optional)

- [ ] Create isolated branch `investigation/tanstack-router-poc`
- [ ] Minimal integration:
  - Install TanStack Router
  - Create 3 routes: `/chat`, `/settings`, `/skills`
  - Use `createMemoryHistory` (appropriate for Electron)
  - Wire navigation from existing UI elements
  - Lazy load one route to test code splitting
- [ ] Measure:
  - Cold start time: before vs. after
  - Bundle size: before vs. after
  - DX: How does development feel with routes vs. Zustand view switching?
- [ ] Document prototype findings

### Task 5: Make Recommendation

- [ ] Write recommendation with one of three outcomes:
  - **Adopt:** TanStack Router provides clear value for OpenWaggle. Proceed with implementation spec.
  - **Defer:** Value exists but is not justified at current scale. Revisit when [specific trigger] happens (e.g., multi-window, 10+ views, deep linking requirement).
  - **Reject:** Router adds complexity without proportional benefit for an Electron app. Zustand view switching is sufficient.
- [ ] Support recommendation with evidence from tasks 1-4
- [ ] If "Adopt": draft high-level implementation plan with route tree, migration approach, estimated effort
- [ ] If "Defer": document the trigger conditions for re-evaluation

---

## Deliverable

This spec produces a **documented recommendation**, not code. The recommendation will be appended to this file as a "## Findings" section with:

1. t3code routing analysis summary
2. Benefit/cost scorecard for OpenWaggle
3. Bundle size measurements
4. Prototype findings (if built)
5. Recommendation with justification

## Timeline

- Task 1-3: Research and analysis (~2 hours)
- Task 4: Optional prototype (~3 hours)
- Task 5: Write recommendation (~30 minutes)

## Cross-References

- None directly. If adopted, would touch `App.tsx`, all navigation patterns, and potentially every view component.

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Investigation yields no clear answer | Low | Define clear evaluation criteria upfront (this spec) |
| Prototype bias (sunk cost) | Low | Prototype is throwaway; decision based on evidence not effort |
| Router adopted but adds complexity without value | Medium | Thorough evaluation before committing |

---

## Findings

_To be filled in after investigation is complete._
