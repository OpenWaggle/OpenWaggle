---
name: openai-codex-subscription-transport
description: "Diagnose and fix OpenAI subscription (OAuth) transport failures in OpenWaggle. Use when OpenAI runs fail with Cloudflare 403 challenges, `api.responses.write` 401 scope errors, `Unsupported parameter: max_output_tokens`, or subscription-mode model-name gating errors while using ChatGPT Codex endpoints."
---

# OpenAI Codex Subscription Transport

## Overview

Fix OpenAI subscription-auth regressions by enforcing the OpenClaw-style split transport contract. Keep API-key traffic on OpenAI API endpoints and route subscription OAuth traffic through ChatGPT Codex responses with compatible payloads and headers.

## Workflow

1. Confirm the failing signature.
- Inspect app logs for `openai-provider` warnings and stack traces.
- Match error signatures with [references/error-signatures.md](references/error-signatures.md).

2. Verify auth-mode transport split.
- API key mode: request adapter should use default OpenAI API behavior.
- Subscription mode: request adapter should target `https://chatgpt.com/backend-api/codex/responses`.
- Typical implementation file: `src/main/providers/openai.ts`.

3. Enforce Codex subscription request contract.
- Rewrite subscription POST requests to `/backend-api/codex/responses`.
- Add required headers:
  - `OpenAI-Beta: responses=experimental`
  - `originator: pi`
  - `chatgpt-account-id` from OAuth JWT claim
  - Explicit `User-Agent`
  - `accept: text/event-stream`
  - `content-type: application/json`
- Normalize payload:
  - Force `store=false`
  - Force `stream=true`
  - Set `text.verbosity=medium` if missing
  - Include `reasoning.encrypted_content`
  - Default `tool_choice=auto` and `parallel_tool_calls=true`
  - Strip unsupported fields (at minimum `max_output_tokens`)

4. Remove invalid subscription preflight gates.
- Do not reject subscription requests only because model names lack `codex`.
- Gate by auth method and token capability, not model-id substring.

5. Keep token validation strict.
- Extract `chatgpt_account_id` from `https://api.openai.com/auth` in JWT payload.
- If missing, return clear re-auth error.

6. Add regression tests.
- Extend `src/main/providers/openai.unit.test.ts` to cover:
  - API-key mode still uses default adapter.
  - Subscription mode rewrites to Codex endpoint.
  - Payload includes required defaults.
  - `max_output_tokens` is stripped.
  - Non-codex model names are accepted in subscription mode.
  - Missing `chatgpt_account_id` token is rejected.

7. Validate changes.
- Run:
  - `pnpm exec vitest run -c vitest.unit.config.ts src/main/providers/openai.unit.test.ts`
  - `pnpm typecheck:node`
  - `pnpm lint`

## Guardrails

- Do not touch Anthropic subscription flows for this skill.
- Do not route subscription OAuth tokens to `api.openai.com/v1/responses`.
- Do not route API keys to ChatGPT Codex backend.
- Do not leave unsupported payload fields in forwarded subscription requests.
- Log non-2xx Codex responses with status, URL, and short response preview for fast diagnosis.
