# Spec 20 — Subscription Auth for Providers

**Goal**: Let users connect their existing ChatGPT Plus/Pro, Claude Pro/Max, and OpenRouter subscriptions to OpenWaggle, so they can start using the app immediately without generating separate API keys. Zero-friction onboarding for users who already pay for AI.

**Status**: Planned

**Depends on**: None (enhances existing provider registry)

---

## The Problem

Every AI coding tool today starts the same way:

1. Download app
2. "Enter your API key"
3. User doesn't have one → goes to provider console → creates account → adds payment → generates key → copies key → pastes into app
4. 10 minutes later they can finally use the tool

For users who already pay $20-200/month for ChatGPT Plus/Pro or an OpenRouter account, this is insulting. They're already paying. They just want to sign in and start coding.

This is a **v1 differentiator**: most competitors (Cursor, Windsurf, Cline, Aider) require API keys. If OpenWaggle lets ChatGPT subscribers sign in with one click and start using GPT-4.1/o3 immediately, that's a meaningful advantage.

---

## Research Results

Comprehensive investigation of every major provider:

| Provider | Subscription Auth | Mechanism | Notes |
|----------|:---:|-----------|-------|
| **OpenAI** | YES | Codex CLI external auth (`chatgptAuthTokens`) | ChatGPT Plus/Pro/Team subscribers. Apache-2.0 SDK. |
| **OpenRouter** | YES | OAuth PKCE (`openrouter.ai/auth`) | 200+ models, user-controlled spending limits. |
| **Anthropic** | YES* | Claude Code OAuth setup-token (`sk-ant-oat01-*`) | *Officially banned for third-party use Feb 2026. OpenClaw uses this. Works until enforcement tightens. |
| **Google Gemini** | NO | Users get permanently banned | Not worth the risk. |
| **xAI/Grok** | NO | No mechanism exists | API key only. |
| **Ollama** | N/A | Local | No auth needed. |

**Strategy**: Support the 3 providers that have a mechanism (OpenAI, Anthropic, OpenRouter), keep API keys as the universal fallback. Anthropic OAuth carries ToS risk — implement it anyway with clear user disclosure.

---

## Architecture

### Auth Flow Overview

```
Settings → Provider → "Sign in with ChatGPT" button
  → Opens system browser for OAuth consent
  → User approves (one click)
  → Token returned to app
  → Provider marked as authenticated
  → Models available immediately

OR

Settings → Provider → "Sign in with Claude" button
  → Runs `claude setup-token` flow (opens browser to claude.ai)
  → User signs in with their Claude account
  → OAuth setup-token (sk-ant-oat01-*) returned
  → Token stored encrypted, used as Bearer auth
  → Claude models available immediately

OR

Settings → Provider → "Connect via OpenRouter" button
  → Opens system browser for OpenRouter OAuth PKCE
  → User sets spending limit
  → API key returned via callback
  → All 200+ OpenRouter models available
```

### Provider Config Extension

Current `ProviderConfig` stores `apiKey` and `baseUrl`. Add an `authMethod` field:

```typescript
export interface ProviderConfig {
  readonly apiKey: string
  readonly baseUrl?: string
  readonly enabled: boolean
  readonly authMethod?: 'api-key' | 'oauth-codex' | 'oauth-anthropic' | 'oauth-openrouter'
  readonly oauthToken?: string      // encrypted, stored in keyring
  readonly oauthExpiresAt?: number   // token expiry timestamp
}
```

When `authMethod` is `'oauth-codex'`, `'oauth-anthropic'`, or `'oauth-openrouter'`, the adapter uses the stored OAuth token instead of `apiKey`.

---

## Implementation

### Phase 1: OpenAI Codex OAuth

The Codex CLI SDK (`@openai/codex`, Apache-2.0) supports an "external auth" mode via `chatgptAuthTokens`. This lets third-party apps authenticate against ChatGPT subscriptions.

**How it works:**
1. App opens system browser to `https://chatgpt.com/auth` (or Codex's auth endpoint)
2. User signs in with their ChatGPT account (already signed in = one click)
3. Auth token returned to app via localhost callback
4. Token used for OpenAI API calls — billed against user's ChatGPT Plus/Pro/Team subscription
5. Token refresh handled automatically

**Implementation:**

- [ ] Install `@openai/codex` as a dependency
- [ ] Create `src/main/auth/codex-auth.ts`
  - `startCodexAuth(): Promise<CodexAuthResult>` — initiates OAuth flow
  - Opens system browser via `shell.openExternal()`
  - Starts localhost HTTP server on random port for callback
  - Extracts `chatgptAuthTokens` from the callback
  - Returns: `{ token: string, expiresAt: number, user: string }`
  - Timeout: 2 minutes (user might need to sign in)
  - Stores token in system keyring via `safeStorage.encryptString()`
- [ ] Create `src/main/auth/token-manager.ts`
  - `getToken(provider: string): Promise<string | null>` — retrieves stored token, checks expiry
  - `storeToken(provider: string, token: string, expiresAt: number): Promise<void>`
  - `clearToken(provider: string): Promise<void>`
  - `isTokenValid(provider: string): boolean` — checks expiry with 5-minute buffer
  - Uses `safeStorage` for encryption at rest (already have `encryptionAvailable` in Settings)
- [ ] Update `src/main/providers/openai.ts`
  - When `authMethod === 'oauth-codex'`, create adapter with OAuth token instead of API key
  - Token refresh: if token expired, prompt user to re-auth (non-blocking notification)
- [ ] Add IPC channels in `src/shared/types/ipc.ts`:
  - `'auth:start-codex-oauth'` — `{} => { success: boolean, user?: string, error?: string }`
  - `'auth:get-auth-status'` — `{ provider: string } => { authenticated: boolean, user?: string, expiresAt?: number }`
  - `'auth:disconnect'` — `{ provider: string } => void`

**Scope**: ChatGPT Plus ($20/mo), Pro ($200/mo), and Team subscribers. Enterprise not supported (different auth flow).

### Phase 2: Anthropic Claude OAuth (OpenClaw Method)

> **ToS Warning**: Anthropic banned third-party use of subscription OAuth tokens on Feb 19, 2026. This works the same way OpenClaw does it — by using the Claude Code setup-token flow and presenting requests as a Claude Code client. Anthropic may block this at any time. Users must be informed of this risk before connecting.

**How it works (reverse-engineered from OpenClaw's `pi-mono` framework):**

1. App initiates the same OAuth flow that `claude setup-token` uses
2. User signs in at `claude.ai` in their browser and approves the authorization
3. An OAuth token (`sk-ant-oat01-*`) is returned — this is tied to the user's Claude Pro ($20/mo) or Max ($100-200/mo) subscription
4. When making API calls, the token is passed as `authToken` (Bearer auth) instead of `apiKey` (x-api-key)
5. Request headers must include Claude Code identity headers for the API to accept the token

**The key technical details (from OpenClaw source):**

```typescript
// Token detection
function isOAuthToken(token: string): boolean {
  return token.startsWith('sk-ant-oat')
}

// Client creation with OAuth token
const client = new Anthropic({
  apiKey: null,                    // must be null, not undefined
  authToken: oauthToken,           // Bearer auth instead of x-api-key
  defaultHeaders: {
    'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20',
    'user-agent': `claude-cli/${CLAUDE_CODE_VERSION} (external, cli)`,
    'x-app': 'cli',
  },
})
```

**Implementation:**

- [ ] Create `src/main/auth/anthropic-auth.ts`
  - `startAnthropicAuth(): Promise<AnthropicAuthResult>` — initiates Claude OAuth flow
  - Replicates the `claude setup-token` OAuth flow:
    1. Generate PKCE code verifier + challenge
    2. Open browser to Anthropic's OAuth authorize endpoint with `code_challenge`
    3. Start localhost HTTP server for callback
    4. Exchange auth code for access token at Anthropic's token endpoint
    5. Returns: `{ token: string, expiresAt: number }`
  - Token format: `sk-ant-oat01-*`
  - Store token encrypted via `safeStorage.encryptString()`
  - **Alternative approach**: If the full OAuth flow is hard to replicate, support manual token paste — user runs `claude setup-token` in their terminal, copies the token, pastes into OpenWaggle settings. Less seamless but guaranteed to work.
- [ ] Update `src/main/providers/anthropic.ts`
  - Detect `authMethod === 'oauth-anthropic'`
  - When creating the Anthropic client:
    - Set `apiKey: null` (not empty string — null disables x-api-key header)
    - Set `authToken: oauthToken` (enables Bearer auth)
    - Set `defaultHeaders` with Claude Code identity headers:
      - `anthropic-beta`: `claude-code-20250219,oauth-2025-04-20`
      - `user-agent`: `claude-cli/{version} (external, cli)`
      - `x-app`: `cli`
  - Inject Claude Code system prompt as first system message (required for the API to accept OAuth tokens):
    ```
    You are Claude Code, Anthropic's official CLI for Claude.
    ```
  - Map tool names to Claude Code canonical names if needed (`readFile` → `Read`, `writeFile` → `Write`, etc.)
- [ ] Add IPC channel: `'auth:start-anthropic-oauth'` — `{} => { success: boolean, error?: string }`
- [ ] Add IPC channel: `'auth:paste-anthropic-token'` — `{ token: string } => { success: boolean, error?: string }`
  - Validates token starts with `sk-ant-oat`
  - Tests token with a lightweight API call before storing
- [ ] Add user-facing disclosure before connecting:
  - "This connects your Claude Pro/Max subscription. Anthropic's terms may restrict this use. Your subscription could be affected. Continue?"
  - User must explicitly acknowledge before proceeding
  - Store acknowledgment so we don't ask every time

**Scope**: Claude Pro ($20/mo), Max ($100/mo and $200/mo). Free tier tokens have very low rate limits.

**Resilience**: If Anthropic blocks this mechanism, the app should:
1. Detect 401/403 errors specific to OAuth token rejection
2. Show clear message: "Claude subscription auth is no longer available. Switch to API key?"
3. Preserve the user's conversation — don't lose work mid-stream
4. Offer one-click switch to API key auth or OpenRouter (which proxies Claude models)

### Phase 3: OpenRouter OAuth PKCE

OpenRouter provides a standard OAuth PKCE flow that works with any third-party app. Users get a scoped API key with their own spending limits.

**How it works:**
1. App opens `https://openrouter.ai/auth?callback_url=...` in system browser
2. User signs in (or is already signed in) and approves spending limit
3. OpenRouter redirects back with an API key
4. This key works like a normal OpenRouter API key but is tied to the user's account

**Implementation:**

- [ ] Create `src/main/auth/openrouter-auth.ts`
  - `startOpenRouterAuth(): Promise<OpenRouterAuthResult>`
  - Opens system browser to `https://openrouter.ai/auth?callback_url=http://localhost:{port}/callback`
  - Localhost callback server extracts the API key from query params
  - Returns: `{ apiKey: string, user?: string }`
  - Key is persistent (no expiry) — stored encrypted in keyring
- [ ] Update `src/main/providers/openrouter.ts`
  - When `authMethod === 'oauth-openrouter'`, use the OAuth-obtained API key
  - Functionally identical to manual API key, but obtained via one-click flow

**Bonus**: OpenRouter covers 200+ models from every provider (Anthropic, Google, Meta, Mistral, etc.). This is effectively the subscription auth backdoor for Anthropic and Gemini models — users pay via their OpenRouter balance instead of needing direct API keys.

### Phase 4: Renderer UI

- [ ] Update Settings panel provider section
  - Each provider shows two auth options (where supported):
    1. **"Sign in"** button — OAuth flow (for OpenAI, Anthropic, OpenRouter)
    2. **"Use API key"** input — existing behavior (all providers)
  - Connected state shows: "Signed in as [user]" with "Disconnect" link
  - API key input hidden when OAuth is active (shows "Using ChatGPT subscription" / "Using Claude subscription" instead)
  - Anthropic OAuth shows a subtle warning badge: "Unofficial — may stop working"
- [ ] Create `src/renderer/src/components/settings/OAuthButton.tsx`
  - "Sign in with ChatGPT" / "Sign in with Claude" / "Connect via OpenRouter" buttons
  - Loading state during OAuth flow
  - Success state: green checkmark + user email/plan
  - Error state: "Failed to connect — try again or use API key"
  - Anthropic button includes disclosure dialog before starting flow
- [ ] Create `src/renderer/src/components/settings/TokenPasteDialog.tsx`
  - Fallback for Anthropic if automated OAuth flow is not feasible
  - Instructions: "Run `claude setup-token` in your terminal, then paste the token here"
  - Token input field with validation (must start with `sk-ant-oat`)
  - Test button to verify token works before saving
- [ ] Update welcome screen / first-run experience
  - If user has no providers configured, show:
    - "Sign in with ChatGPT" (largest, most prominent — most users have this)
    - "Sign in with Claude" (second — large Claude Pro/Max user base)
    - "Connect via OpenRouter" (third — covers everything else)
    - "Or use API keys" (collapsed/smaller — for power users)
  - This makes first-run go from 10 minutes to 30 seconds

### Phase 5: Token Lifecycle

- [ ] Token refresh for Codex OAuth
  - Background check every 30 minutes
  - If token expires within 1 hour, attempt silent refresh
  - If refresh fails, show non-blocking notification: "ChatGPT session expired — sign in again to continue"
  - Fallback: queue messages until re-auth, don't lose user's work
- [ ] Token refresh for Anthropic OAuth
  - `sk-ant-oat01-*` tokens have an expiry — check before each request
  - If expired, attempt refresh via Anthropic's token endpoint
  - If refresh fails, prompt re-auth or suggest switching to API key
- [ ] Graceful degradation
  - If OAuth token fails mid-conversation (rate limit, account issue, enforcement block):
    - Show clear error: "ChatGPT subscription limit reached" / "Claude subscription auth blocked" / "OpenRouter balance depleted"
    - Offer fallback: "Switch to API key?" or "Connect via OpenRouter?"
    - **Anthropic-specific**: detect 401/403 with enforcement-related error messages → show "Anthropic has blocked subscription auth for third-party apps. Switch to API key or OpenRouter."
  - Never silently fail — always tell the user what happened and what to do
- [ ] Token cleanup on disconnect
  - "Disconnect" button clears token from keyring
  - Reverts provider to "not configured" state (or switches back to API key if one exists)

---

## What This Unlocks

| Scenario | Before | After |
|----------|--------|-------|
| ChatGPT Plus user tries OpenWaggle | Generate API key (10 min) | "Sign in with ChatGPT" (30 sec) |
| Claude Pro/Max user tries OpenWaggle | Generate API key (10 min) | "Sign in with Claude" (30 sec) |
| User wants to try multiple models | Configure 3+ API keys | One OpenRouter sign-in → all models |
| User hits rate limit on one provider | Manually switch API keys | OpenRouter auto-routes |
| Team sharing the app | Each member manages own keys | Each member signs in with their account |

---

## Security Considerations

- **Token storage**: Use Electron's `safeStorage.encryptString()` — encrypts via OS keychain (macOS Keychain, Windows DPAPI, Linux libsecret). Already proven in the app (see `encryptionAvailable` in Settings).
- **Localhost callback**: Use random port + single-use token to prevent port hijacking. Callback server shuts down immediately after receiving the response.
- **No token logging**: Tokens never appear in logs. Log auth events as `"codex-oauth: authenticated"` without token content. Anthropic `sk-ant-oat*` tokens must never be logged, even partially.
- **PKCE**: OpenRouter and Anthropic OAuth use PKCE (Proof Key for Code Exchange) — standard protection against authorization code interception.
- **Anthropic disclosure**: Users must acknowledge risk before connecting Claude subscription. Store acknowledgment flag per-user (not per-session) so it's not asked repeatedly, but show it once clearly.
- **Kill switch**: If Anthropic enforcement becomes aggressive (e.g., banning user accounts rather than just rejecting tokens), add a remote config flag to disable the "Sign in with Claude" option entirely. Ship this as an app update or check a simple JSON endpoint on startup.

---

## Files to Create

- `src/main/auth/codex-auth.ts` — Codex OAuth flow
- `src/main/auth/anthropic-auth.ts` — Anthropic OAuth flow (OpenClaw method)
- `src/main/auth/openrouter-auth.ts` — OpenRouter OAuth PKCE flow
- `src/main/auth/token-manager.ts` — encrypted token storage + refresh
- `src/renderer/src/components/settings/OAuthButton.tsx` — sign-in buttons
- `src/renderer/src/components/settings/TokenPasteDialog.tsx` — manual token paste fallback

## Files to Modify

- `src/shared/types/settings.ts` — extend `ProviderConfig` with auth fields
- `src/shared/types/ipc.ts` — auth IPC channels
- `src/main/providers/openai.ts` — OAuth token adapter path
- `src/main/providers/anthropic.ts` — OAuth token adapter path + Claude Code identity headers
- `src/main/providers/openrouter.ts` — OAuth API key adapter path
- `src/main/ipc/` — new auth IPC handlers
- `src/preload/api.ts` — expose auth methods
- `src/renderer/src/components/settings/` — OAuth UI in provider settings
- `src/renderer/src/stores/settings-store.ts` — auth state

---

## Verification

- [ ] "Sign in with ChatGPT" opens browser, completes OAuth, stores token, shows "Signed in as [email]"
- [ ] After sign-in, OpenAI models immediately available without entering API key
- [ ] "Sign in with Claude" shows disclosure dialog, user acknowledges, completes OAuth, stores token
- [ ] After Claude sign-in, Anthropic models available without entering API key
- [ ] Claude OAuth requests include correct identity headers (`anthropic-beta`, `user-agent`, `x-app`)
- [ ] Manual token paste works as fallback for Anthropic (validates `sk-ant-oat` prefix, tests before saving)
- [ ] "Connect via OpenRouter" opens browser, completes OAuth PKCE, stores key, shows connected state
- [ ] After OpenRouter connect, all 200+ models available (including Anthropic, Gemini models via OpenRouter)
- [ ] Token persists across app restarts (encrypted in keyring)
- [ ] Token expiry triggers non-blocking re-auth prompt (Codex, Anthropic)
- [ ] "Disconnect" clears token and reverts to "not configured" state
- [ ] First-run experience shows OAuth options prominently (before API key inputs)
- [ ] Auth works when `encryptionAvailable` is false (falls back to encrypted electron-store, not plaintext)
- [ ] No tokens appear in log files
- [ ] OAuth callback server shuts down after receiving response (no lingering localhost server)
- [ ] Graceful error when user denies OAuth consent or closes browser
- [ ] If Anthropic blocks OAuth tokens (401/403), clear error shown with fallback options (API key / OpenRouter)
- [ ] Anthropic enforcement detection does not disrupt other providers' auth
