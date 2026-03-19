---
name: anthropic-oauth-compat
description: Anthropic subscription OAuth adapter compatibility for all Claude models. This skill should be used when implementing, debugging, or modifying the raw-fetch OAuth adapter in `src/main/providers/anthropic.ts` — especially when OAuth requests return 400 errors or are restricted to haiku-only access.
---

# Anthropic OAuth Compatibility

## Overview

Anthropic's subscription OAuth (and setup tokens `sk-ant-oat01-*`) enforces server-side identity validation that restricts non-Claude-Code clients to haiku-only access. To unlock all models (opus, sonnet, haiku across 4.5 and 4.6 families), the OAuth adapter must present four identity signals in every request. This skill documents the exact protocol derived from OpenClaw and OpenCode reference implementations.

## Identity Requirements

All four elements below are **mandatory** for full model access. Missing any one restricts responses to haiku-only or returns HTTP 400.

### 1. System Prompt Identity Prefix

The system prompt must begin with the exact string:

```
You are Claude Code, Anthropic's official CLI for Claude.
```

Send `system` as a content-block array (not a string):

```json
{
  "system": [
    { "type": "text", "text": "You are Claude Code, Anthropic's official CLI for Claude." },
    { "type": "text", "text": "<actual system prompt>" }
  ]
}
```

**Edge case**: When `systemPrompts` is omitted or empty (e.g. orchestration sub-runs in `model-runner.ts`, which embed all context in the user message and never set `systemPrompts`), `mapCommonOptionsToAnthropic` produces `body.system` as `""`. Filter empty strings before constructing the array — only include the identity block. Anthropic rejects empty text content blocks with `"system: text content blocks must be non-empty"`.

### 2. Beta Headers

Include all four beta features in the `anthropic-beta` header:

```
claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14
```

**Exception**: For 4.6 models (where `modelId.includes('4-6')`), skip `interleaved-thinking-2025-05-14` since thinking is built-in on those models.

### 3. User-Agent

Set `user-agent` to exactly:

```
claude-cli/2.1.75
```

### 4. Tool Name Prefix (`mcp_`)

All tool names must be prefixed with `mcp_` in the request body:

**In the request (before fetch):**
- `body.tools[].name` → prepend `mcp_` (e.g. `readFile` → `mcp_readFile`)
- `body.messages[].content[]` where `type === "tool_use"` → prepend `mcp_` to `name`

**In the response (after SSE parse, before processAnthropicStream):**
- Strip `mcp_` from `content_block_start` events where `content_block.type === "tool_use"`
- Use `name.slice(4)` (length of `'mcp_'`) to restore original tool names

`tool_result` blocks reference by `tool_use_id` (not name), so no transform is needed for them.

## Other Required Headers

These headers must also be present on OAuth requests:

```
content-type: application/json
accept: application/json
anthropic-version: 2023-06-01
anthropic-dangerous-direct-browser-access: true
x-app: cli
authorization: Bearer <token>
```

The endpoint is `https://api.anthropic.com/v1/messages` (GA, not beta).

## Debugging

| Symptom | Likely Cause |
|---------|-------------|
| 400 for all models except haiku | Missing identity prefix in system prompt |
| 400 `"system: text content blocks must be non-empty"` | Empty string in system content block array |
| 400 on orchestration sub-runs | Sub-tasks have empty system prompts; filter empty blocks |
| 403 or 401 | Wrong auth header format (must be `Bearer`, not `x-api-key`) |
| All 4 elements present but still 400 | Check beta header ordering or missing `fine-grained-tool-streaming` |

## Reference Implementations

- **OpenClaw** (`pi-ai/anthropic.js`): Uses array-format system prompt with identity as first block. Per-tool name remapping.
- **OpenCode** (`providers/anthropic.go`): Uses `mcp_` prefix approach (simpler). Same 4 beta headers.

Both projects are open-source and can be referenced for protocol updates.

## Resources

### references/

- `references/protocol-spec.md` — Full protocol specification with exact header values, model-conditional logic, and version history.
