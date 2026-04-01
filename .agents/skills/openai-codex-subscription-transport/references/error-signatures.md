# OpenAI Subscription Error Signatures

Use this mapping to identify root cause quickly from logs.

## Signature: Cloudflare challenge HTML (403)

- Symptom:
  - `403` with HTML challenge page from `chatgpt.com`
  - `cf-mitigated: challenge`
- Common cause:
  - Request path/headers are not Codex-compatible for ChatGPT backend.
- Primary fix:
  - Ensure subscription requests are rewritten to `/backend-api/codex/responses`.
  - Ensure Codex headers are set (`chatgpt-account-id`, `OpenAI-Beta`, `originator`, `User-Agent`).

## Signature: 401 missing `api.responses.write`

- Symptom:
  - `You have insufficient permissions... Missing scopes: api.responses.write`
- Common cause:
  - Subscription OAuth token is being sent to OpenAI API endpoint (`api.openai.com/v1/responses`).
- Primary fix:
  - Route subscription OAuth traffic to ChatGPT Codex backend.
  - Keep API-key traffic on OpenAI API endpoints only.

## Signature: 400 `Unsupported parameter: max_output_tokens`

- Symptom:
  - Response preview includes `{"detail":"Unsupported parameter: max_output_tokens"}`
- Common cause:
  - Generic Responses payload forwarded unchanged to ChatGPT Codex endpoint.
- Primary fix:
  - Strip `max_output_tokens` from subscription transport payload rewrite.

## Signature: `OpenAI subscription auth only supports Codex models`

- Symptom:
  - Preflight failure before network request.
- Common cause:
  - Local model-name substring gate (`codex`) blocks valid subscription routing.
- Primary fix:
  - Remove model-name gate; route by auth method and token capability instead.

## Signature: missing `chatgpt_account_id`

- Symptom:
  - Error indicates token missing `chatgpt_account_id`.
- Common cause:
  - Invalid/stale token or wrong token type used for subscription mode.
- Primary fix:
  - Re-authenticate via OpenAI OAuth and parse account id from JWT claims.
