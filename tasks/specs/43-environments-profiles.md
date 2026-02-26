# 43 — Environments & Profiles

**Status:** Planned
**Priority:** P4
**Category:** Feature
**Depends on:** None
**Origin:** Waggle conversation review — SettingsNav has disabled "Environments" tab (line 27), `SettingsTab` type includes `'environments'` (ui-store.ts line 13)

---

## Problem

Users working across multiple projects or contexts need different configurations:

- **Project A** (startup): Uses Haiku for speed, low safety defaults, rapid iteration
- **Project B** (enterprise client): Uses Opus for quality, strict approval for all writes, audit logging
- **Personal experiments**: Uses Ollama local models, no API costs
- **Code review mode**: Read-only tools, Sonnet for cost-effective review

Today, switching between these contexts requires manually:
1. Changing the model in the dropdown
2. Toggling tool approval settings
3. Switching API keys (if different billing accounts)
4. Adjusting any custom instructions

There's no way to save, name, or quickly switch between these bundles. The Settings UI has an "Environments" tab placeholder but no backing feature.

### What Exists

- `SettingsNav.tsx` line 27: `environments` tab — `enabled: false`
- `ui-store.ts` line 13: `SettingsTab` type includes `'environments'`
- `SettingsPage.tsx`: No handler for `environments` tab (falls through to "Coming soon")
- **Settings store** already manages individual settings (model, API keys, tool approval preferences)
- **Waggle presets** (`TeamPreset` in `src/shared/types/waggle.ts`): Concept of named, switchable configurations already exists for waggle mode — environments extend this pattern to single-agent settings

### Reference: How other tools do this

| Tool | Environment Concept |
|------|-------------------|
| VS Code | Profiles — named bundles of settings, extensions, and keybindings. Switch via bottom-left avatar |
| JetBrains | Run Configurations — per-project or shared, with environment variables |
| Cursor | Project-level `.cursorrules` — per-project AI behavior, but no switchable profiles |
| Warp | Sessions — saved shell configurations with environment variables |

## Architecture

### Environment Definition

```typescript
interface Environment {
  id: string
  name: string                    // "Fast & Cheap", "Enterprise", "Local Only"
  description?: string
  icon?: string                   // Emoji or icon identifier
  isDefault?: boolean             // At most one default environment

  /** Model configuration */
  model?: SupportedModelId        // Override default model

  /** Provider configuration */
  providerOverrides?: {
    /** Use specific API key set (if multiple keys stored) */
    preferredProvider?: string
  }

  /** Tool safety */
  toolApproval?: 'all' | 'writes-only' | 'none'  // Which tools need approval

  /** Personalization override (from Spec 41) */
  customInstructions?: string     // Additional instructions for this environment

  /** Waggle default (from Spec 00) */
  waggleConfig?: WaggleConfig
}
```

### Storage

Environments are **user-global** — stored in `electron-store` alongside other settings. They reference models and providers by ID, so they're portable across projects.

A conversation can optionally be tagged with an environment ID, so opening it restores the correct settings context.

### Activation

When an environment is activated:
1. Model selector updates to show the environment's model (if set)
2. Tool approval behavior changes
3. Custom instructions are merged with global personalization
4. Waggle config is applied (if set)
5. UI shows environment badge in header/status bar

## Implementation

### Phase 1: Environment CRUD

- [ ] Define `Environment` type in `src/shared/types/settings.ts`
- [ ] Store environments array in `electron-store`
- [ ] Add IPC channels:
  - `'environments:list'` → returns all environments
  - `'environments:get'` → get specific environment by ID
  - `'environments:create'` → create new environment
  - `'environments:update'` → update existing
  - `'environments:delete'` → remove environment
  - `'environments:activate'` → set active environment for current session
  - `'environments:get-active'` → returns currently active environment ID (or null)
- [ ] Seed 2-3 built-in environments:
  - "Fast" — Haiku, no-approval, concise tone
  - "Balanced" — Sonnet, writes-approval, default tone (this is the default)
  - "Thorough" — Opus, all-approval, detailed tone

### Phase 2: Environment application

- [ ] When an environment is activated, propagate overrides to:
  - Agent loop: model selection, tool approval behavior
  - System prompt: custom instructions merge
  - Waggle coordinator: default config
- [ ] Store active environment ID in session state (Zustand)
- [ ] Optionally persist per-conversation: add `environmentId?: string` to `Conversation` type

### Phase 3: Settings UI

- [ ] Enable `environments` tab in `SettingsNav.tsx` (line 27)
- [ ] Create `src/renderer/src/components/settings/sections/EnvironmentsSection.tsx`:
  - List of environments with name, model badge, description
  - "New Environment" button → inline form or dialog
  - Edit/delete/duplicate actions on each
  - "Set as Default" action
  - Active environment highlighted
- [ ] Add to `SettingsPage.tsx` tab switch
- [ ] Add environment switcher to status bar or model selector area:
  - Quick switch without opening settings
  - Show current environment name + icon

### Phase 4: Command palette integration

- [ ] Add `switch-environment` command to `CommandPalette.tsx`:
  - Lists all environments
  - Selecting one activates it immediately
  - Shows current active environment with checkmark
- [ ] Add `create-environment` command for quick creation

## Files to Create

- `src/renderer/src/components/settings/sections/EnvironmentsSection.tsx` — settings tab
- `src/shared/types/environment.ts` — (or add to settings.ts) type definitions

## Files to Modify

- `src/shared/types/ipc.ts` — environment IPC channels
- `src/renderer/src/components/settings/SettingsNav.tsx` — enable environments tab (line 27)
- `src/renderer/src/components/settings/SettingsPage.tsx` — add EnvironmentsSection
- `src/renderer/src/stores/ui-store.ts` — active environment state
- `src/main/agent/agent-loop.ts` — apply environment model override
- `src/main/agent/system-prompt.ts` — merge environment custom instructions
- `src/shared/types/conversation.ts` — optional `environmentId` field
- `src/renderer/src/components/command-palette/CommandPalette.tsx` — add environment commands

## Tests

- Unit: environment activation applies correct model override
- Unit: custom instructions merge correctly (global + environment)
- Unit: built-in environments can't be deleted
- Component: environments settings tab renders list with correct state
- Component: environment switcher shows active environment
- Integration: activate environment → send message → agent uses correct model
