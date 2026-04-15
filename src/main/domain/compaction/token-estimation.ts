// Pure token estimation functions — zero infrastructure imports.
// Uses chars / 4 heuristic (same as Codex CLI). No tokenizer library needed.

/**
 * Approximate token count for a string.
 * Heuristic: 1 token ~ 4 characters. Conservative enough for safety margins.
 */
export function estimateTokens(text: string): number {
  const CHARS_PER_TOKEN = 4
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/**
 * Estimate token count for a single chat message.
 * Accounts for role overhead, content, tool call arguments, and toolCallId.
 */
export function estimateMessageTokens(msg: {
  readonly role: string
  readonly content: string | null | readonly unknown[]
  readonly toolCalls?: readonly { readonly function: { readonly arguments: string } }[]
  readonly toolCallId?: string
}): number {
  const ROLE_OVERHEAD_TOKENS = 4
  let tokens = ROLE_OVERHEAD_TOKENS

  if (typeof msg.content === 'string') {
    tokens += estimateTokens(msg.content)
  }

  if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if (isTextContent(part)) {
        tokens += estimateTokens(part.content)
      }
    }
  }

  if (msg.toolCalls) {
    for (const tc of msg.toolCalls) {
      tokens += estimateTokens(tc.function.arguments)
    }
  }

  if (msg.toolCallId) {
    tokens += estimateTokens(msg.toolCallId)
  }

  return tokens
}

/**
 * Estimate total token count for a message array.
 */
export function estimateMessagesTokens(
  messages: readonly {
    readonly role: string
    readonly content: string | null | readonly unknown[]
    readonly toolCalls?: readonly { readonly function: { readonly arguments: string } }[]
    readonly toolCallId?: string
  }[],
): number {
  let total = 0
  for (const msg of messages) {
    total += estimateMessageTokens(msg)
  }
  return total
}

// ─── Type guard ─────────────────────────────────────────────

function isTextContent(part: unknown): part is { content: string } {
  if (typeof part !== 'object' || part === null) return false
  if (!('content' in part)) return false
  // After 'content' in part narrowing, TS knows the property exists
  const { content } = part
  return typeof content === 'string'
}
