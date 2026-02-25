# 00 — Subscription Auth for Providers

**Status:** Planned
**Priority:** P0
**Category:** Feature
**Depends on:** None (enhances existing provider registry)
**Origin:** Spec 20

---

## Goal

Let users connect existing ChatGPT Plus/Pro, Claude Pro/Max, and OpenRouter subscriptions to OpenWaggle — zero-friction onboarding without generating separate API keys.

## Research Results

| Provider | Subscription Auth | Mechanism |
|----------|:---:|-----------|
| **OpenAI** | YES | Codex CLI external auth (`chatgptAuthTokens`) |
| **OpenRouter** | YES | OAuth PKCE (`openrouter.ai/auth`) |
| **Anthropic** | YES* | Claude Code OAuth setup-token (*ToS risk) |
| **Google Gemini** | NO | Users get banned |
| **xAI/Grok** | NO | No mechanism |
| **Ollama** | N/A | Local |

## Implementation

### Phase 1: OpenAI Codex OAuth
- [ ] `src/main/auth/codex-auth.ts` — OAuth flow via system browser
- [ ] `src/main/auth/token-manager.ts` — encrypted token storage + refresh
- [ ] Update `src/main/providers/openai.ts` for OAuth token path

### Phase 2: Anthropic Claude OAuth
- [ ] `src/main/auth/anthropic-auth.ts` — Claude Code setup-token flow
- [ ] Update `src/main/providers/anthropic.ts` with Claude Code identity headers
- [ ] Add user-facing ToS disclosure before connecting

### Phase 3: OpenRouter OAuth PKCE
- [ ] `src/main/auth/openrouter-auth.ts` — standard OAuth PKCE flow
- [ ] Update `src/main/providers/openrouter.ts`

### Phase 4: Renderer UI
- [ ] "Sign in with ChatGPT" / "Sign in with Claude" / "Connect via OpenRouter" buttons
- [ ] Token paste dialog as Anthropic fallback
- [ ] First-run experience with OAuth options prominent

### Phase 5: Token Lifecycle
- [ ] Background token refresh
- [ ] Graceful degradation on token failure
- [ ] Clear disconnect flow

## Files to Create

- `src/main/auth/codex-auth.ts`
- `src/main/auth/anthropic-auth.ts`
- `src/main/auth/openrouter-auth.ts`
- `src/main/auth/token-manager.ts`
- `src/renderer/src/components/settings/OAuthButton.tsx`
- `src/renderer/src/components/settings/TokenPasteDialog.tsx`

## Files to Modify

- `src/shared/types/settings.ts` — extend `ProviderConfig`
- `src/shared/types/ipc.ts` — auth IPC channels
- `src/main/providers/{openai,anthropic,openrouter}.ts`
- `src/renderer/src/components/settings/` — OAuth UI
