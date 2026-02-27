# Spec 60 — OpenAI Subscription 403 Cloudflare Challenge

## Objective

Fix OpenAI subscription-auth runs by matching OpenClaw's split transport behavior:
- API-key auth stays on the standard OpenAI API transport.
- Subscription (Codex OAuth) auth uses the ChatGPT Codex responses endpoint.

## PRD Alignment Check

- Reviewed `docs/product/ui-interaction-prd.md`.
- This task does **not** map to an `HC-UI-*` planned/future UI feature.
- Scope is backend provider transport behavior only.

## Plan

- [x] Confirm root cause in OpenAI provider adapter configuration.
- [x] Implement minimal fix in provider adapter creation for subscription mode.
- [x] Add/adjust provider unit tests to prevent endpoint regression.
- [x] Run targeted tests and type checks for touched areas.
- [x] Document review outcomes and residual risks.

## Review Notes

- Root cause confirmed from runtime logs:
  - `https://chatgpt.com/backend-api/responses` caused Cloudflare challenge `403`.
  - `https://api.openai.com/v1/responses` with OAuth token failed `401` (`Missing scopes: api.responses.write`).
- OpenClaw parity implemented by transport split:
  - `api-key` mode uses default OpenAI API adapter behavior.
  - `subscription` mode now routes to `https://chatgpt.com/backend-api/codex/responses` with OpenClaw-style URL normalization from `baseURL: https://chatgpt.com/backend-api`.
- Subscription safety guard added:
  - OpenAI subscription mode now rejects OAuth tokens missing `chatgpt_account_id` with a clear re-auth message.
  - Removed local model-name gating so subscription requests are not blocked solely because a model id does not contain `codex`; routing now follows auth mode, matching OpenClaw-style transport behavior.
- Codex payload compatibility:
  - Subscription transport enforces `store: false` on `/responses` payloads to match Codex endpoint requirements.
  - Subscription transport enforces Codex defaults used by OpenClaw (`stream=true`, `text.verbosity=medium`, `include=['reasoning.encrypted_content']`, `tool_choice=auto`, `parallel_tool_calls=true`).
  - Subscription transport strips `max_output_tokens` before forwarding to ChatGPT Codex responses because this endpoint rejects it (`Unsupported parameter: max_output_tokens`).
- Codex header compatibility:
  - Subscription transport now sets OpenClaw-equivalent headers (`OpenAI-Beta: responses=experimental`, `originator: pi`, `chatgpt-account-id`, `User-Agent`, SSE accept/content-type).
- Runtime diagnostics:
  - Non-2xx Codex responses are now logged with status + URL + short response preview to make opaque `400 status code (no body)` failures actionable.
- Regression coverage:
  - `src/main/providers/openai.unit.test.ts` now verifies:
    - API-key mode keeps default OpenAI transport.
    - Subscription mode uses Codex endpoint config.
    - Subscription requests force `store=false`.
    - Subscription requests strip `max_output_tokens`.
    - Backend URL normalization rewrites `.../backend-api` POSTs to `.../backend-api/codex/responses`.
    - Codex headers include `chatgpt-account-id` and `User-Agent`.
    - Non-Codex model ids are allowed in subscription mode (no preflight name gate).
    - Invalid subscription token shape (missing account id claim) is rejected.
- Validation run:
  - `pnpm exec vitest run -c vitest.unit.config.ts src/main/providers/openai.unit.test.ts`
  - `pnpm typecheck:node`
  - `pnpm lint`
