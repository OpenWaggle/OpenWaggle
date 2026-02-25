# Spec 00 — Subscription Auth for Providers

## Status: Complete ✅ (Code Review Follow-up Complete — 2026-02-25)

## Summary

Implemented OAuth-based "Sign in with..." flows for OpenRouter, OpenAI, and Anthropic so users can connect existing subscriptions instead of manually entering API keys.

## Implementation

### New Files (12)
- `src/shared/types/auth.ts` — `SubscriptionProvider`, `OAuthFlowStatus`, `SubscriptionAccountInfo`, Zod schemas
- `src/main/store/encryption.ts` — Extracted `encryptString`/`decryptString` from settings.ts
- `src/main/auth/pkce.ts` — PKCE verifier + S256 challenge generation
- `src/main/auth/oauth-callback-server.ts` — Ephemeral HTTP server for OAuth callbacks
- `src/main/auth/token-manager.ts` — Encrypted token storage with auto-refresh mutex
- `src/main/auth/flows/openrouter-oauth.ts` — OpenRouter PKCE → permanent API key
- `src/main/auth/flows/openai-oauth.ts` — OpenAI OAuth PKCE → JWT tokens + refresh
- `src/main/auth/flows/anthropic-oauth.ts` — Anthropic OAuth PKCE → tokens + refresh
- `src/main/auth/index.ts` — Auth orchestrator (startOAuth, disconnect, getAccountInfo, getActiveApiKey)
- `src/main/ipc/auth-handler.ts` — IPC handler registration for auth channels
- `src/renderer/src/components/settings/SubscriptionAuthButton.tsx` — UI component with all states

### Modified Files (15)
- `src/shared/types/settings.ts` — Added `authMethod?: AuthMethod` to `ProviderConfig`
- `src/shared/types/ipc.ts` — Added 3 invoke channels, 1 event channel, 4 API methods
- `src/shared/types/llm.ts` — Added `supportsSubscription: boolean` to `ProviderInfo`
- `src/main/store/settings.ts` — Uses extracted encryption, added `authMethod` to schema
- `src/main/providers/provider-definition.ts` — Added `supportsSubscription` to interface
- `src/main/providers/{openrouter,openai,anthropic}.ts` — `supportsSubscription: true`
- `src/main/providers/{gemini,grok,ollama}.ts` — `supportsSubscription: false`
- `src/main/ipc/providers-handler.ts` — Exposes `supportsSubscription` in response
- `src/main/index.ts` — Registers `registerAuthHandlers()`
- `src/preload/api.ts` — 4 new auth methods
- `src/main/agent/shared.ts` — `resolveProviderAndQuality()` now async, refreshes token for subscription auth
- `src/renderer/src/stores/settings-store.ts` — Auth state + actions
- `src/renderer/src/hooks/useSettings.ts` — Exposes auth state, subscribes to OAuth status events
- `src/renderer/src/components/settings/sections/GeneralSection.tsx` — Integrates auth button
- `src/renderer/src/components/settings/SettingsDialog.tsx` — Integrates auth button

### Test Files (9)
- `src/main/auth/pkce.unit.test.ts` — 6 tests
- `src/main/auth/oauth-callback-server.unit.test.ts` — 7 tests
- `src/main/auth/token-manager.unit.test.ts` — 8 tests
- `src/main/store/encryption.unit.test.ts` — 6 tests
- `src/main/auth/flows/openrouter-oauth.unit.test.ts` — 5 tests
- `src/main/auth/flows/openai-oauth.unit.test.ts` — 7 tests
- `src/main/auth/flows/anthropic-oauth.unit.test.ts` — 6 tests
- `src/main/ipc/auth-handler.integration.test.ts` — 3 tests
- `src/renderer/src/components/settings/__tests__/SubscriptionAuthButton.component.test.tsx` — 10 tests

## Verification

- [x] `pnpm typecheck` passes
- [x] `pnpm lint` clean
- [x] `pnpm test:unit` — 537 tests pass (58 files)
- [x] `pnpm test:integration` — 83 tests pass (14 files)
- [x] `pnpm test:component` — 79 tests pass (8 files)

## Review Remediation (2026-02-25)

- [x] Stop Anthropic clipboard polling when manual code submission wins the race.
- [x] Tighten token presence checks to require decryptable/parseable token payloads.
- [x] Scope pending manual code handlers by provider to avoid cross-flow resolution.
- [x] Remove unsafe cast usage from updated auth/provider setup paths.

## Open Risk: Anthropic OAuth TOS (2026-02-25, codebase audit)

`SubscriptionAuthButton.tsx` surfaces a warning: *"Anthropic's Terms of Service prohibit
using subscription OAuth tokens in third-party applications."* The feature works
technically, but shipping it with a disclaimer is not a product strategy — it's deferred
risk.

**Decision needed:** Either (a) remove Anthropic subscription auth entirely until TOS
permits it, (b) get explicit permission from Anthropic, or (c) accept the risk and
document the rationale. The current state of "ship it but warn users" leaves both the
project and users in a gray area. This should be resolved before Spec 35 (ship to users).
