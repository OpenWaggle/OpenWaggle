import type { Conversation } from '@shared/types/conversation'
import type { SupportedModelId } from '@shared/types/llm'

/** Derives a message-id → model-id lookup from conversation assistant messages. */
export function useMessageModelLookup(
  conversation: Conversation | null,
): Record<string, SupportedModelId> {
  const lookup: Record<string, SupportedModelId> = {}
  for (const msg of conversation?.messages ?? []) {
    if (msg.role === 'assistant' && msg.model) {
      lookup[String(msg.id)] = msg.model
    }
  }
  return lookup
}
