# Task 49 — Dynamic Provider Model Fetch Wiring (Ollama-first)

## Objective
Wire dynamic provider model discovery into renderer settings/model state so OpenWaggle can use runtime-discovered models (especially local Ollama tags) instead of relying only on static SDK model lists.

## PRD Alignment
- Extends `HC-UI-016 Universal model picker (multi-provider + favorites)` in `docs/product/ui-interaction-prd.md`.
- Preserves picker UX (provider tabs, favorites, search) while making model source dynamic where supported.

## Current Gap
- `providers:fetch-models` IPC already exists and works.
- Renderer currently loads only `providers:get-models` (static lists) in `useSettingsStore.loadProviderModels()`.
- Result: Ollama local server/models are not surfaced dynamically by default.

## Scope
- In scope:
  - Renderer data wiring for dynamic fetch + merge policy.
  - Ollama dynamic model hydration (and generic support for any provider implementing `fetchModels`).
  - Deterministic dedupe and stable ordering.
  - Test coverage for success/failure/empty responses.
- Out of scope:
  - Auto-starting Ollama daemon.
  - New backend IPC channels (reuse existing `providers:fetch-models`).
  - Major picker visual redesign.

## Decision Points (Need Confirmation)
1. **Dynamic policy for provider lists**
- Option A (recommended): `replace-on-success` per provider (if dynamic fetch returns models, use those for that provider; fallback to static on empty/error).
- Option B: `union` dynamic + static.
- Option C: dynamic-only for Ollama, keep static-only for all others.

2. **Fetch trigger policy**
- Option A (recommended): fetch dynamically on initial load + on relevant provider config changes (enable/baseUrl/apiKey where applicable) + manual refresh action in store.
- Option B: fetch only on initial load.
- Option C: fetch on every picker open (higher churn, likely unnecessary).

## Implementation Plan
1. **Store data model and merge utility**
- Add a pure helper in `src/renderer/src/stores/settings-store.ts` (or nearby utility) that combines static provider groups with dynamic fetched groups by provider.
- Enforce dedupe by `provider:modelId` and stable sorting (keep dynamic API order; fallback to static order).
- Preserve provider metadata fields (`displayName`, `requiresApiKey`, `supportsBaseUrl`, `supportsSubscription`).

2. **Dynamic fetch wiring in settings store**
- Update `loadProviderModels()` to:
  - load static groups via `api.getProviderModels()` first,
  - conditionally fetch dynamic models for providers that support runtime fetch inputs,
  - merge according to chosen policy,
  - fail soft (never throw, retain static list on dynamic failure).
- Add `refreshProviderModels(provider?: Provider)` action to allow targeted refreshes and future UI hooks.

3. **Trigger wiring**
- Re-trigger targeted dynamic refresh after relevant updates in store actions:
  - `updateBaseUrl(provider, ...)`,
  - `toggleProvider(provider, enabled)`,
  - `updateApiKey(provider, ...)` (safe generic hook for providers that may require keys later).
- Keep updates non-blocking for UX (persist settings first, refresh models async).

4. **UI integration (no redesign)**
- Keep `ModelSelector` behavior unchanged (tabs/search/favorites/keyboard nav).
- Ensure it consumes updated `providerModels` without duplicate row warnings.

5. **Testing expansion**
- Update `src/renderer/src/stores/settings-store.integration.test.ts`:
  - loads static + dynamic models and applies merge policy,
  - dynamic fetch failure falls back to static,
  - duplicate dynamic entries dedupe correctly,
  - provider config changes trigger targeted refresh.
- Add/adjust `providers-handler` integration tests only if mapping/shape changes are needed.
- Keep existing `ModelSelector` tests green; add one assertion proving dynamically fetched provider entries render.

6. **Docs update**
- Update `docs/product/ui-interaction-prd.md` `HC-UI-016` implementation note to mention runtime provider model discovery (Ollama tags).
- Add high-signal technical learnings if any non-obvious constraints are discovered during implementation.

## Acceptance Criteria
- When Ollama is running with local models, picker shows those runtime tags without app restart.
- Dynamic fetch failures do not break model selection; static fallback remains available.
- No duplicate model rows or React duplicate-key warnings from provider payloads.
- `pnpm test` passes.
- `pnpm check` passes.
- No API contract break for `ModelSelector` callers (`onChange`, `providerModels`, settings actions).

## Risk & Mitigation
- Risk: dynamic fetch latency blocks settings load.
  - Mitigation: optimistic static load first, then async merge update.
- Risk: provider payload inconsistencies create duplicates.
  - Mitigation: central dedupe by `provider:modelId` in merge helper.
- Risk: refresh loops after settings writes.
  - Mitigation: targeted refresh calls only in mutation endpoints; avoid `useEffect` loops.

## Verification Plan
- Automated:
  - `pnpm test src/renderer/src/stores/settings-store.integration.test.ts`
  - `pnpm test src/renderer/src/components/shared/__tests__/ModelSelector.component.test.tsx`
  - `pnpm check`
- Manual:
  - Start Ollama and pull a model (e.g. `ollama pull qwen2.5-coder`).
  - Open OpenWaggle model picker, switch to Ollama tab, verify runtime model appears.
  - Change Ollama base URL, verify list refreshes/falls back appropriately.

## Implementation Review (2026-02-26)

### Delivered
- Added explicit provider metadata flag `supportsDynamicModelFetch` and propagated it through provider definitions and `providers:get-models` IPC mapping.
- Wired renderer `useSettingsStore` with:
  - static baseline cache (`baseProviderModels`),
  - race-guarded `refreshProviderModels(provider?)`,
  - replace-on-success provider merge policy with static fallback on empty/error,
  - deterministic de-duplication by `provider:modelId`,
  - targeted refresh triggers after `updateApiKey`, `updateBaseUrl`, and `toggleProvider`.
- Updated HC-UI-016 PRD text to capture runtime dynamic model hydration behavior.

### Test Coverage Added
- `settings-store.integration.test.ts`:
  - static-first load then dynamic replacement,
  - empty/error fallback retention,
  - duplicate dynamic entry de-duplication,
  - targeted refresh triggers after provider config mutations.
- `providers-handler.integration.test.ts`:
  - `supportsDynamicModelFetch` included in `providers:get-models`.

### Verification
- `pnpm check` ✅
- `pnpm test` ✅
