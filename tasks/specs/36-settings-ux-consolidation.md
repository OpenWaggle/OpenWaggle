# 36 — Settings UX Consolidation

**Status:** Planned
**Priority:** P3
**Category:** Fix (UI debt)
**Depends on:** None
**Origin:** Multi-agent conversation review (GPT 5.2 + GPT 5.1 Codex analysis)

---

## Problem

There are two diverging settings surfaces in the app:

1. **`SettingsPage`** (`src/renderer/src/components/settings/SettingsPage.tsx`) — A full-page layout with left nav (8 tabs) and content area. Added during the multi-agent (Spec 00) work. Only `GeneralSection` and `CoworkSection` render real content; all other tabs show "Coming soon" (line 49).

2. **`SettingsDialog`** (`src/renderer/src/components/settings/SettingsDialog.tsx`) — A modal dialog that renders provider API key forms, base URL inputs, and browser headless toggle. This was the **original** settings UI before `SettingsPage` was introduced.

`SettingsDialog` appears to be an orphan — no component imports it anywhere in `src/renderer/src/`. However, it still exists as a 282-line file and could cause confusion. It also contains useful components (`BaseUrlInput`, `EncryptionWarning`, `ApiKeyForm` integration) that should be preserved or merged into the new settings system.

### UX Inconsistency

The `SettingsPage` (via `GeneralSection`) likely duplicates some of what `SettingsDialog` had. If any code path still renders the dialog (e.g., via the Welcome Screen or a first-run flow), users would see two completely different settings experiences.

### UI PRD Violation

The UI Interaction PRD (`docs/product/ui-interaction-prd.md`) states: "Users need confidence that visible controls map to real behavior." Having two settings surfaces with different capabilities contradicts this principle.

## What Exists

| File | Surface | Content |
|------|---------|---------|
| `src/renderer/src/components/settings/SettingsPage.tsx` | Full-page | General + Co-work tabs, 6 disabled "Coming soon" tabs |
| `src/renderer/src/components/settings/SettingsDialog.tsx` | Modal | Provider API keys, base URL, browser headless, encryption warning |
| `src/renderer/src/components/settings/SettingsNav.tsx` | Left nav | 8 tabs, 2 enabled, 6 disabled |
| `src/renderer/src/stores/ui-store.ts` | State | `settingsOpen`, `activeView: 'settings'`, `activeSettingsTab` (line 7-15) |
| `src/renderer/src/components/settings/sections/GeneralSection.tsx` | Tab content | Provider settings (likely overlap with Dialog) |

## Implementation

### Phase 1: Audit and consolidate

- [ ] Verify `SettingsDialog` is truly unreferenced (grep all import/render paths)
- [ ] Compare `GeneralSection` vs `SettingsDialog` content — identify any features in the Dialog that aren't in GeneralSection
- [ ] Migrate any Dialog-only features (e.g., `EncryptionWarning`, `BaseUrlInput` pattern) into `GeneralSection`
- [ ] Delete `SettingsDialog.tsx` once all functionality is confirmed present in `SettingsPage`

### Phase 2: Clean up disabled tabs

- [ ] For each disabled tab in `SettingsNav.tsx` (line 21-29):
  - If there's a matching spec that will implement it → keep the tab but show "Planned" instead of "Coming soon"
  - If there's no spec and no near-term plan → **remove the tab entirely**
- [ ] Ensure `SettingsTabContent` (line 41-53) handles only real tabs, not a catch-all default

### Phase 3: Settings state cleanup

- [ ] Remove `settingsOpen` from `ui-store.ts` if it's redundant with `activeView === 'settings'` (it may be — `openSettings()` sets both, line 70-77)
- [ ] Ensure exactly one code path opens settings

## Files to Touch

- `src/renderer/src/components/settings/SettingsDialog.tsx` — delete (after migration)
- `src/renderer/src/components/settings/SettingsPage.tsx` — update tab routing
- `src/renderer/src/components/settings/SettingsNav.tsx` — remove unplanned tabs
- `src/renderer/src/components/settings/sections/GeneralSection.tsx` — absorb Dialog features
- `src/renderer/src/stores/ui-store.ts` — simplify settings state

## Tests

- Component: only one settings entry point exists in the render tree
- Component: no "Coming soon" text renders for any accessible tab
- Unit: `SettingsDialog` import references are zero
