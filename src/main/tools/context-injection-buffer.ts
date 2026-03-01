import type { ConversationId } from '@shared/types/brand'
import type { NormalizedToolResult } from './define-tool'

export interface BufferedContextItem {
  readonly text: string
  readonly timestamp: number
}

/** Injection result returned by applyContextInjection */
export interface ContextInjectionResult {
  readonly result: string | NormalizedToolResult
  readonly injectedItems: readonly BufferedContextItem[]
}

/** Per-conversation context injection buffer */
const buffers = new Map<ConversationId, BufferedContextItem[]>()

export function pushContext(conversationId: ConversationId, text: string): void {
  const items = buffers.get(conversationId) ?? []
  items.push({ text, timestamp: Date.now() })
  buffers.set(conversationId, items)
}

export function drainContext(conversationId: ConversationId): BufferedContextItem[] {
  const items = buffers.get(conversationId)
  if (!items || items.length === 0) return []
  buffers.delete(conversationId)
  return items
}

export function clearContext(conversationId: ConversationId): void {
  buffers.delete(conversationId)
}

export function hasContext(conversationId: ConversationId): boolean {
  const items = buffers.get(conversationId)
  return !!items && items.length > 0
}

/**
 * Drains buffered context for a conversation and appends it to the tool result
 * as a `<user_context_update>` tag. Returns the (possibly modified) result and
 * the list of injected items for downstream emission.
 *
 * If no context is buffered, returns the original result unchanged.
 */
export function applyContextInjection(
  conversationId: ConversationId,
  rawResult: string | NormalizedToolResult,
): ContextInjectionResult {
  const injectedItems = drainContext(conversationId)
  if (injectedItems.length === 0) {
    return { result: rawResult, injectedItems }
  }

  const contextBlock = injectedItems.map((item) => item.text).join('\n\n')
  const tag = `\n\n<user_context_update>\nThe user sent the following message(s) while you were working. Incorporate this context into your ongoing work without stopping or restarting:\n\n${contextBlock}\n</user_context_update>`

  return { result: appendContextTag(rawResult, tag), injectedItems }
}

function appendContextTag(
  rawResult: string | NormalizedToolResult,
  tag: string,
): string | NormalizedToolResult {
  if (typeof rawResult === 'string') {
    return rawResult + tag
  }
  if (rawResult.kind === 'text') {
    return { kind: 'text', text: rawResult.text + tag }
  }
  // JSON results: convert to text to carry the injection
  return { kind: 'text', text: JSON.stringify(rawResult.data) + tag }
}
