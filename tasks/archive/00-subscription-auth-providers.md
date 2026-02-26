# 00 — Subscription Auth for Providers

**Status:** Done
**Priority:** P0
**Category:** Feature
**Depends on:** None (enhances existing provider registry)
**Origin:** Spec 20

---

## Goal

Let users connect existing ChatGPT Plus/Pro, Claude Pro/Max, and OpenRouter subscriptions to OpenWaggle with a safe, resilient auth lifecycle.

## Reality Check (2026-02-25)

Most of this spec was already implemented before this execution pass:

- OAuth flows already existed for OpenAI, OpenRouter, and Anthropic.
- Encrypted token storage + refresh already existed in `src/main/auth/token-manager.ts`.
- Settings UI already exposed subscription connection controls.

This pass focuses on hardening and gap closure, not re-implementing from scratch.

## External Pattern Alignment

Reviewed implementation patterns from Codex CLI / Claude Code / OpenCode / OpenClaw, then applied the lowest-risk improvements that fit OpenWaggle's architecture:

- OpenAI manual-code fallback path when localhost callback binding fails.
- Clear user disclosure/confirmation for Anthropic ToS risk.
- Stronger auth flow lifecycle guards (concurrency + background validity checks).

## Implementation

### Phase 1: Core Auth Flows (existing + verified)
- [x] OpenAI OAuth via system browser + PKCE (`src/main/auth/flows/openai-oauth.ts`)
- [x] OpenRouter OAuth PKCE (`src/main/auth/flows/openrouter-oauth.ts`)
- [x] Anthropic OAuth/manual-code flow (`src/main/auth/flows/anthropic-oauth.ts`)
- [x] Encrypted token persistence + refresh (`src/main/auth/token-manager.ts`)

### Phase 2: Provider Runtime Integration (existing + verified)
- [x] OpenAI provider supports subscription auth mode
- [x] Anthropic provider supports subscription auth headers/beta contract
- [x] OpenRouter provider supports subscription-auth key usage

### Phase 3: Hardening Gaps (this pass)
- [x] Add per-provider in-flight OAuth lock to prevent race/double-start
- [x] Add background auth lifecycle tick for proactive refresh/expiry signaling
- [x] Add OpenAI manual-code fallback path for callback server failure cases
- [x] Improve code-entry UX copy for OpenAI fallback path
- [x] Add explicit Anthropic ToS confirmation gate before subscription sign-in

### Phase 4: Battle Testing (this pass)
- [x] Add unit coverage for auth flow lock and manual code path (`src/main/auth/index.unit.test.ts`)
- [x] Add lifecycle recovery/expiry coverage (`src/main/auth/index.unit.test.ts`)
- [x] Extend OpenAI OAuth unit suite for callback-server-failure fallback (`src/main/auth/flows/openai-oauth.unit.test.ts`)
- [x] Extend renderer settings-store integration tests for Anthropic risk confirmation gate (`src/renderer/src/stores/settings-store.integration.test.ts`)
- [x] Keep auth IPC integration tests green (`src/main/ipc/auth-handler.integration.test.ts`)

## Remaining Work Before Marking Done

- [x] Run full repo verification gates (`pnpm check`, `pnpm test`, `pnpm build`).
- [x] Complete final code-review/fix sweep.
- [x] Move this spec to `tasks/archive/` after gates are green.
