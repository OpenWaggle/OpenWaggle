# Anthropic Subscription OAuth Protocol Specification

## Version History

| Date | Change |
|------|--------|
| 2026-03-18 | Initial spec derived from OpenClaw/OpenCode analysis. All 5 subscription models verified working. |
| 2026-02 | Anthropic enforces identity validation server-side (policy change). Third-party apps restricted to haiku-only. |

## Verified Working Models (Subscription OAuth)

```
claude-opus-4-6      (200k ctx, 128k max output)
claude-opus-4-5      (200k ctx, 64k max output)
claude-sonnet-4-6    (200k ctx, 64k max output)
claude-sonnet-4-5    (200k ctx, 64k max output)
claude-haiku-4-5     (200k ctx, 64k max output)
```

## Full Request Template

```http
POST https://api.anthropic.com/v1/messages
Content-Type: application/json
Accept: application/json
Anthropic-Version: 2023-06-01
Anthropic-Dangerous-Direct-Browser-Access: true
Anthropic-Beta: claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14
User-Agent: claude-cli/2.1.75
X-App: cli
Authorization: Bearer <oauth-token-or-setup-token>
```

### Beta Header Variants

**Pre-4.6 models** (sonnet-4-5, opus-4-5, haiku-4-5):
```
claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14
```

**4.6 models** (sonnet-4-6, opus-4-6):
```
claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14
```

The `interleaved-thinking-2025-05-14` beta is skipped for 4.6 models because thinking is built-in (adaptive thinking via `output_config.effort`).

## Request Body Structure

```json
{
  "model": "claude-opus-4-6",
  "stream": true,
  "system": [
    { "type": "text", "text": "You are Claude Code, Anthropic's official CLI for Claude." },
    { "type": "text", "text": "Your actual system prompt content here." }
  ],
  "messages": [
    {
      "role": "user",
      "content": "Hello"
    }
  ],
  "tools": [
    {
      "name": "mcp_readFile",
      "description": "Read a file",
      "input_schema": { "type": "object", "properties": { "path": { "type": "string" } } }
    }
  ],
  "max_tokens": 16000
}
```

### System Prompt Rules

1. First content block MUST be `{ type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." }`
2. Additional content blocks contain the actual system prompt
3. Empty text blocks are rejected — filter `""` strings before constructing the array
4. The Anthropic API accepts both `system: "string"` and `system: [{type:"text", text:"..."}]` formats, but the array format is required for the identity prefix pattern

### Tool Name Prefixing

**Outbound (request body):**
- `tools[].name`: `readFile` → `mcp_readFile`
- `messages[].content[].name` where `type === "tool_use"`: `readFile` → `mcp_readFile`

**Inbound (response stream):**
- `content_block_start` events where `content_block.type === "tool_use"`: strip `mcp_` prefix
- `content_block_delta` events: no name field, no transform needed
- `tool_result` blocks: reference by `tool_use_id`, no name transform needed

## Authentication Types

### Setup Tokens
- Format: `sk-ant-oat01-*`
- Auth: `Authorization: Bearer <token>`
- Same identity requirements as subscription OAuth

### Subscription OAuth
- Obtained via OAuth 2.0 PKCE flow
- Auth: `Authorization: Bearer <token>`
- Token refresh via standard OAuth refresh flow
- Fatal refresh failures (400/401) should clear stored token immediately

### Standard API Keys
- Format: `sk-ant-api*`
- Auth: `x-api-key: <key>` (NOT Bearer)
- No identity requirements — use pure TanStack adapter
- All models accessible without spoofing

## Implementation Location

In OpenWaggle: `src/main/providers/anthropic.ts` → `createOAuthAdapter()` function.

The adapter overrides `chatStream` on a base `AnthropicTextAdapter` instance to use raw `fetch` with Bearer auth instead of the SDK's `x-api-key` path. The base adapter is kept solely for its `processAnthropicStream` method (SSE event → StreamChunk conversion).

## SSE Stream Pipeline

```
fetch response.body (ReadableStream<Uint8Array>)
  → parseAnthropicSSE (raw bytes → parsed JSON event objects)
  → stripMcpToolPrefix (remove mcp_ from tool_use names)
  → processAnthropicStream (Anthropic events → TanStack StreamChunk)
  → yield* (AsyncIterable<StreamChunk>)
```
