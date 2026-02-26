# Spec 00: Waggle Conversation

## Status: Complete (Phase 1)

## Implementation Checklist

### Step 0: Settings UI Refactor
- [x] `SettingsPage.tsx` — Full-page layout with left nav + content
- [x] `SettingsNav.tsx` — Left navigation (8 tabs, 2 functional)
- [x] `GeneralSection.tsx` — Extract current SettingsDialog content
- [x] Modify `ui-store.ts` — Add `activeSettingsTab` and `'settings'` view
- [x] Modify `App.tsx` — Render SettingsPage when `activeView === 'settings'`
- [x] Remove `SettingsDialog` modal usage

### Step 1: Type System
- [x] `src/shared/types/waggle.ts` — All waggle types
- [x] Extend `brand.ts` — Add `TeamConfigId`
- [x] Extend `agent.ts` — Add `waggle` metadata
- [x] Extend `conversation.ts` — Add optional `waggleConfig`
- [x] Update Zod schemas in `conversations.ts`

### Step 2: Backend Core
- [x] `consensus-detector.ts` — Pure heuristic function
- [x] `file-conflict-tracker.ts` — Track cross-agent file edits
- [x] `waggle-coordinator.ts` — Sequential turn-taking
- [x] `teams.ts` — Team presets persistence + built-ins

### Step 3: IPC Wiring
- [x] Extend `ipc.ts` — New channels
- [x] `waggle-handler.ts` — Waggle IPC handler
- [x] `teams-handler.ts` — Team CRUD handlers
- [x] Extend `preload/api.ts` — New API methods
- [x] Extend `stream-bridge.ts` — Waggle stream emitter
- [x] Register handlers in `index.ts`

### Step 4: Renderer — Waggle Mode Settings Tab
- [x] `WaggleSection.tsx` — Presets, agent slots, collaboration config
- [x] `waggle-store.ts` — Zustand store for waggle mode state

### Step 5: Renderer — Chat Integration
- [x] Modify `MessageBubble.tsx` — Agent color borders + labels
- [x] `TurnDivider.tsx` — Visual turn separator
- [x] `CollaborationStatus.tsx` — Status bar above composer
- [x] `useWaggleChat.ts` — IPC subscription hook
- [x] `useWaggleMetadataLookup.ts` — Message metadata lookup hook
- [x] Modify `ChatPanel.tsx` — Wire waggle display + TurnDivider
- [ ] Modify `Composer.tsx` — Start Collaboration button (deferred — collaboration starts from settings)

### Tests
- [x] `consensus-detector.unit.test.ts` — 26 tests
- [x] `file-conflict-tracker.unit.test.ts` — 26 tests
- [x] `teams.unit.test.ts` — 18 tests
- [x] Existing `ChatPanel.component.test.tsx` updated for new prop

### Future (Phase 2+)
- [ ] Parallel mode (`runWaggleParallel`)
- [ ] Synthesis step for parallel outputs
- [ ] User intervention between turns
- [ ] Command palette waggle mode entry

## Review

Phase 1 implements sequential waggle collaboration end-to-end:
- Settings UI refactored from modal to full-page with tabbed navigation
- Two agents take turns with consensus detection and file conflict tracking
- Team presets (3 built-in + custom CRUD) persist via electron-store
- Chat UI shows colored agent labels, turn dividers, and collaboration status
- All 147 tests pass, typecheck and lint clean
