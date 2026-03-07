# 54 — Configurable Keybindings System

**Status:** Not Started
**Priority:** P2
**Category:** Feature
**Depends on:** None
**Origin:** T3Code competitive analysis — t3code has `~/.t3/keybindings.json` with `when` conditional expressions (VS Code-style). Reference: [t3code](https://github.com/pingdotgg/t3code) keybindings system with conditional `when` clauses.

---

## Problem

Keybindings in OpenWaggle are hardcoded across multiple components with no centralized registry or user configuration:

- **Composer.tsx** (lines 159-248): Enter, Shift+Enter, ArrowUp, ArrowDown, `/`
- **CommandPalette.tsx**: Escape, ArrowUp, ArrowDown, Enter for palette navigation
- **TerminalPanel.tsx**: Terminal-specific shortcuts
- **App.tsx**: Global shortcuts (Cmd+K for command palette, etc.)

Issues:
1. **No user customization** — Power users cannot rebind shortcuts
2. **No centralized registry** — Keybindings scattered across components, hard to audit
3. **No context awareness** — Each component manages its own key handlers independently; no system-level arbitration
4. **No discoverability** — Users cannot see what keybindings exist without reading code

t3code implements a VS Code-inspired keybinding system with:
- A JSON config file (`~/.t3/keybindings.json`) for user overrides
- `when` clause conditional expressions for context-dependent shortcuts
- Centralized dispatch with priority resolution

## Implementation

### Phase 1: Keybinding Registry & Default Bindings

- [ ] Create `src/renderer/src/lib/keybindings/types.ts`:
  ```typescript
  type ActionId = string // e.g., 'composer.submit'
  type WhenContext = string // e.g., 'composerFocused && !isStreaming'

  interface Keybinding {
    key: string          // e.g., 'Enter', 'Ctrl+K Ctrl+S'
    action: ActionId
    when?: WhenContext   // optional context condition
  }

  interface KeybindingEntry {
    key: string
    action: ActionId
    when?: WhenContext
    source: 'default' | 'user'
  }
  ```
- [ ] Create `src/renderer/src/lib/keybindings/actions.ts` — exhaustive list of action IDs:
  ```typescript
  // Composer
  'composer.submit'
  'composer.newline'
  'composer.historyUp'
  'composer.historyDown'
  'composer.triggerCommandPalette'
  'composer.togglePlanMode'
  'composer.attachFile'
  'composer.toggleVoice'

  // Command Palette
  'commandPalette.open'
  'commandPalette.close'
  'commandPalette.selectItem'
  'commandPalette.moveUp'
  'commandPalette.moveDown'

  // Navigation
  'navigation.newConversation'
  'navigation.settings'
  'navigation.previousConversation'
  'navigation.nextConversation'

  // Terminal
  'terminal.toggle'
  'terminal.focus'
  'terminal.clear'

  // Agent
  'agent.cancel'
  'agent.retry'

  // Diff
  'diff.toggle'
  'diff.nextFile'
  'diff.prevFile'
  ```
- [ ] Create `src/renderer/src/lib/keybindings/defaults.ts` — default keybinding map extracted from current hardcoded bindings:
  ```typescript
  const DEFAULT_KEYBINDINGS: Keybinding[] = [
    { key: 'Enter', action: 'composer.submit', when: 'composerFocused && !isStreaming' },
    { key: 'Shift+Enter', action: 'composer.newline', when: 'composerFocused' },
    { key: 'ArrowUp', action: 'composer.historyUp', when: 'composerFocused && cursorAtStart' },
    { key: 'ArrowDown', action: 'composer.historyDown', when: 'composerFocused && cursorAtEnd' },
    { key: 'Mod+K', action: 'commandPalette.open' },
    { key: 'Escape', action: 'commandPalette.close', when: 'commandPaletteOpen' },
    { key: 'ArrowUp', action: 'commandPalette.moveUp', when: 'commandPaletteOpen' },
    { key: 'ArrowDown', action: 'commandPalette.moveDown', when: 'commandPaletteOpen' },
    { key: 'Enter', action: 'commandPalette.selectItem', when: 'commandPaletteOpen' },
    { key: 'Mod+N', action: 'navigation.newConversation' },
    { key: 'Mod+,', action: 'navigation.settings' },
    { key: 'Mod+`', action: 'terminal.toggle' },
    { key: 'Escape', action: 'agent.cancel', when: 'isStreaming' },
    // ... all other current keybindings
  ]
  ```
  - `Mod` = `Cmd` on macOS, `Ctrl` on Windows/Linux
- [ ] Create `src/renderer/src/lib/keybindings/registry.ts` — singleton `KeybindingRegistry`:
  - `register(bindings: Keybinding[], source: 'default' | 'user'): void`
  - `getBinding(actionId: ActionId): KeybindingEntry | undefined`
  - `getAllBindings(): KeybindingEntry[]`
  - `resolve(event: KeyboardEvent, contexts: WhenContextMap): ActionId | undefined` — given a keyboard event and current contexts, resolve to an action
  - User bindings override defaults for the same action
  - Priority: user > default; more specific `when` > less specific

### Phase 2: `when` Context System

- [ ] Create `src/renderer/src/lib/keybindings/when-context.ts`:
  - Context variables:
    ```typescript
    interface WhenContextMap {
      composerFocused: boolean
      commandPaletteOpen: boolean
      terminalFocused: boolean
      settingsOpen: boolean
      isStreaming: boolean
      hasActiveConversation: boolean
      cursorAtStart: boolean
      cursorAtEnd: boolean
      diffPanelOpen: boolean
      planModeActive: boolean
    }
    ```
  - Expression evaluator: parse `when` strings like `'composerFocused && !isStreaming'`
  - Supported operators: `&&`, `||`, `!`, parentheses
  - Keep it simple — no comparison operators, just boolean context checks
  - `evaluateWhen(expression: string, contexts: WhenContextMap): boolean`
- [ ] Create `src/renderer/src/lib/keybindings/when-context-provider.ts`:
  - React hook `useWhenContexts(): WhenContextMap` that aggregates current context:
    - Reads from Zustand stores (`useChatStore`, `useUIStore`)
    - Reads from DOM focus state for `composerFocused`, `terminalFocused`
    - Updates reactively when any context changes
- [ ] Unit tests for `when` expression evaluation:
  - `'composerFocused'` → true when composerFocused is true
  - `'composerFocused && !isStreaming'` → true only when both conditions met
  - `'commandPaletteOpen || settingsOpen'` → true when either is true
  - `'!commandPaletteOpen'` → true when palette is closed
  - Invalid expressions → graceful fallback (treat as always-true)

### Phase 3: Global Keyboard Dispatcher

- [ ] Create `src/renderer/src/lib/keybindings/dispatcher.ts`:
  - Manages action handler registration: `onAction(actionId, handler): unsubscribe`
  - Single `document.addEventListener('keydown', ...)` listener
  - On keydown:
    1. Normalize event to key string (e.g., `'Ctrl+K'`, `'Shift+Enter'`)
    2. Gather current `WhenContextMap`
    3. Call `registry.resolve(event, contexts)` to find matching action
    4. If action found and handler registered → call handler, `event.preventDefault()`
    5. If no match → let event propagate normally
  - **Chord support:** Track pending chord prefix (e.g., after `Ctrl+K`, wait for second key)
    - Chord timeout: 1 second (if second key not pressed, cancel chord)
    - Visual indicator: show "Ctrl+K was pressed, waiting for next key..." in status area
- [ ] Create `src/renderer/src/hooks/useKeybindingAction.ts`:
  ```typescript
  function useKeybindingAction(actionId: ActionId, handler: () => void): void
  ```
  - Registers handler with dispatcher on mount, unregisters on unmount
  - Used by components to declare what action they handle
- [ ] Migrate existing keybindings in `Composer.tsx`:
  - Replace direct `onKeyDown` handler with `useKeybindingAction('composer.submit', handleSubmit)`, etc.
  - Remove hardcoded key checks from component
- [ ] Migrate `CommandPalette.tsx`, `App.tsx`, `TerminalPanel.tsx` similarly
- [ ] Create `src/renderer/src/hooks/useKeybindingDisplay.ts`:
  ```typescript
  function useKeybindingDisplay(actionId: ActionId): string
  ```
  - Returns human-readable key combo for display in tooltips and UI (e.g., `'⌘K'` on macOS, `'Ctrl+K'` on Windows)
  - Used by buttons, menu items, and command palette to show shortcut hints

### Phase 4: User Configuration

- [ ] Create Zod schema for keybindings config file in `src/shared/schemas/`:
  ```typescript
  const keybindingConfigSchema = z.array(z.object({
    key: z.string(),
    action: z.string(),
    when: z.string().optional(),
  }))
  ```
- [ ] Add IPC channels:
  - `'settings:get-keybindings'` → returns user keybindings from config file (or empty array if none)
  - `'settings:save-keybindings'` → writes keybindings to config file
  - `'settings:keybindings-changed'` → event channel for hot-reload notifications
- [ ] Implement `keybindings-handler.ts` in `src/main/ipc/`:
  - Config file location: `{userData}/keybindings.json` (or `~/.openwaggle/keybindings.json`)
  - Load with Zod validation; ignore invalid entries with warning log
  - Watch file for changes via `fs.watch()`, emit `'settings:keybindings-changed'` event
  - Graceful handling: missing file = no user overrides; malformed JSON = log warning, use defaults
- [ ] Load user keybindings on renderer startup:
  - Fetch via IPC on app init
  - Register user bindings in registry (overrides defaults)
  - Subscribe to `'settings:keybindings-changed'` for hot-reload

### Phase 5: Settings UI

- [ ] Create `src/renderer/src/components/settings/KeybindingsTab.tsx`:
  - Table view of all keybindings: Action name | Key combo | When context | Source (default/user)
  - Searchable/filterable by action name or key
  - Click on key combo cell → enter "record mode" (next keypress sets new binding)
  - "Reset to default" button per binding
  - "Reset all" button
  - Show conflicts (two actions bound to same key + context) with warning
- [ ] Register Keybindings tab in Settings page (reference Spec 36 settings consolidation)
- [ ] Add keybinding hints to Command Palette entries:
  - Each command shows its shortcut on the right side (reference Spec 37 command palette wiring)
  - Use `useKeybindingDisplay(actionId)` for consistent rendering

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/renderer/src/lib/keybindings/types.ts` | Type definitions |
| `src/renderer/src/lib/keybindings/actions.ts` | Action ID registry |
| `src/renderer/src/lib/keybindings/defaults.ts` | Default keybinding map |
| `src/renderer/src/lib/keybindings/registry.ts` | Centralized keybinding registry |
| `src/renderer/src/lib/keybindings/when-context.ts` | When expression evaluator |
| `src/renderer/src/lib/keybindings/when-context-provider.ts` | React context provider |
| `src/renderer/src/lib/keybindings/dispatcher.ts` | Global keyboard event dispatcher |
| `src/renderer/src/hooks/useKeybindingAction.ts` | Hook for registering action handlers |
| `src/renderer/src/hooks/useKeybindingDisplay.ts` | Hook for displaying key combos in UI |
| `src/renderer/src/components/settings/KeybindingsTab.tsx` | Settings UI tab |
| `src/main/ipc/keybindings-handler.ts` | Main process config handler |
| `src/shared/schemas/keybindings.ts` | Zod validation schema |

## Files to Modify

| File | Change |
|------|--------|
| `src/renderer/src/components/composer/Composer.tsx` | Replace `onKeyDown` with `useKeybindingAction` hooks |
| `src/renderer/src/components/CommandPalette.tsx` | Replace key handlers with `useKeybindingAction` |
| `src/renderer/src/App.tsx` | Add global dispatcher, remove hardcoded global shortcuts |
| `src/shared/types/ipc.ts` | Add keybinding IPC channels |
| `src/preload/api.ts` | Add keybinding API methods |
| `src/main/index.ts` | Register keybinding IPC handlers |

## Cross-References

- **Spec 36 (Settings UX Consolidation)** — Keybindings tab integrates into consolidated Settings page
- **Spec 37 (Command Palette Wiring)** — Palette entries should display keybinding hints

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing keybindings during migration | High | Incremental migration; keep hardcoded fallbacks until fully tested |
| `when` expression parser bugs | Medium | Thorough unit tests; graceful fallback on parse errors |
| Chord support complexity | Medium | Implement basic chords first; can defer to future iteration |
| Conflicting user bindings | Low | Show conflicts in Settings UI with warnings |
| macOS vs Windows/Linux key differences | Medium | Use `Mod` abstraction; test on both platforms |

## Definition of Done

1. All existing keybindings work identically after migration to registry
2. User can create `keybindings.json` to override defaults
3. `when` clauses work for context-dependent shortcuts
4. Settings UI shows all keybindings with inline editing
5. Command palette shows shortcut hints
6. Hot-reload works: editing config file updates bindings without restart
7. Chord sequences work (e.g., `Ctrl+K Ctrl+S`)
8. No keybinding regressions in Composer, CommandPalette, Terminal, or global shortcuts

## Testing Strategy

- **Unit tests:** `when-context.unit.test.ts` — expression evaluation with all operator combinations
- **Unit tests:** `registry.unit.test.ts` — binding resolution, user override priority, conflict detection
- **Unit tests:** `dispatcher.unit.test.ts` — event normalization, chord timeout, action dispatch
- **Component tests:** `Composer.component.test.tsx` — verify submit, newline, history still work via keybinding system
- **Component tests:** `KeybindingsTab.component.test.tsx` — binding display, edit mode, reset
- **Integration tests:** Config file loading, hot-reload detection, IPC round-trip
