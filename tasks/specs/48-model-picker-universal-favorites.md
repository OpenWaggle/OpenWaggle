# Task 48 — Universal Model Picker (T3-style) + Favorites

## Objective
Implement a pixel-accurate model picker inspired by the provided Pencil screens so users can easily browse/select models across providers, with provider logos and one-click favorite/unfavorite behavior.

## PRD Alignment
- Adds a new UI interaction capability in the same spirit as `HC-UI` controls in `docs/product/ui-interaction-prd.md`.
- Scope extends composer/settings model selection UX only; runtime model execution and provider registry behavior remain backward-compatible.

## Requirements
- [x] Replace current grouped dropdown UX in `ModelSelector` with T3-style picker layout.
- [x] Add provider logo rail (favorites tab + provider tabs).
- [x] Add search input to filter models by name/id/provider.
- [x] Add star toggle on every row for favorite/unfavorite.
- [x] Persist favorites in user settings and hydrate on app load.
- [x] Keep selection contract stable: `onChange(modelId)` and external callers unchanged.
- [x] Preserve model availability safety (cannot select unavailable models).
- [x] Improve accessibility (keyboard nav, ARIA labeling, disabled semantics).

## Implementation Plan
1. Data contracts + persistence
- Extend `Settings` with `favoriteModels`.
- Add sanitize/resolve/update logic in main settings store.
- Extend `settings:update` IPC validation schema.
- Add renderer settings-store actions to toggle favorite models.

2. UI refactor
- Redesign `ModelSelector` to match Pencil screens:
  - search bar,
  - left provider rail with logos,
  - main list rows with title/subtitle and star control.
- Use existing official provider logo components from `components/icons/provider-icons.tsx`.
- Show all providers in selector; gate selection by availability checks.

3. Behavior hardening
- Keep keyboard open/close/select behavior.
- Prevent star-click from selecting row.
- Ensure favorites view gracefully handles empty state.
- Ensure selected model remains visible and highlighted under filters.

4. Test expansion
- Add component tests for:
  - search filtering,
  - provider/favorites tabs,
  - favorite toggle persistence callback,
  - disabled-row behavior,
  - selection behavior.
- Add renderer settings-store integration tests for favorites actions.
- Add main settings-store unit tests for favorite model sanitization roundtrip.

5. Verification
- [x] `pnpm test`
- [x] `pnpm check`
- [x] `pnpm build`

## Review Notes
- Completed on 2026-02-26.
- Implemented universal model picker with:
  - searchable model list,
  - provider logo rail tabs,
  - favorites tab + row star toggle,
  - auto-enable provider flow on model selection.
- Added persistence and sanitization for `favoriteModels` in shared/main/renderer settings paths.
- Added and updated tests:
  - `src/renderer/src/components/shared/__tests__/ModelSelector.component.test.tsx`
  - `src/renderer/src/stores/settings-store.integration.test.ts`
  - `src/main/store/settings.unit.test.ts`
