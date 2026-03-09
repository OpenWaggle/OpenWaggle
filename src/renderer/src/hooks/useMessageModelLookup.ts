import type { Conversation } from '@shared/types/conversation'
import type { SupportedModelId } from '@shared/types/llm'
import { useRef } from 'react'

const EMPTY_MESSAGE_MODEL_LOOKUP: Readonly<Record<string, SupportedModelId>> = Object.freeze({})

/** Derives a message-id → model-id lookup from conversation assistant messages. */
export function useMessageModelLookup(
  conversation: Conversation | null,
): Readonly<Record<string, SupportedModelId>> {
  const cacheRef = useRef<{
    conversation: Conversation | null
    messages: Conversation['messages'] | null
    lookup: Readonly<Record<string, SupportedModelId>>
  } | null>(null)

  const messages = conversation?.messages ?? null
  if (!messages) {
    cacheRef.current = {
      conversation,
      messages,
      lookup: EMPTY_MESSAGE_MODEL_LOOKUP,
    }
    return EMPTY_MESSAGE_MODEL_LOOKUP
  }

  if (cacheRef.current?.conversation === conversation && cacheRef.current.messages === messages) {
    return cacheRef.current.lookup
  }

  const lookup: Record<string, SupportedModelId> = {}
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.model) {
      lookup[String(msg.id)] = msg.model
    }
  }

  const stableLookup = Object.freeze(lookup)
  cacheRef.current = {
    conversation,
    messages,
    lookup: stableLookup,
  }
  return stableLookup
}
