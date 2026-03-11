import type { Conversation } from '@shared/types/conversation'
import type { UIMessage } from '@tanstack/ai-react'
import { useRef } from 'react'
import {
  buildPersistedToolCallLookup,
  type PersistedToolCallLookup,
} from '@/lib/persisted-tool-call-reconciliation'
import { restorePersistedToolCallMetadataWithLookup } from './useAgentChat.utils'

interface PersistedToolCallLookupCacheEntry {
  readonly conversation: Conversation | null
  readonly lookup: PersistedToolCallLookup
}

interface HydratedMessagesCacheEntry {
  readonly messages: UIMessage[]
  readonly lookup: PersistedToolCallLookup
  readonly result: UIMessage[]
}

/**
 * Restores persisted tool-call metadata (approval state, arguments, etc.)
 * onto the TanStack UIMessages by looking up the corresponding entries in
 * the persisted conversation. Both lookups are render-time ref caches
 * that only recompute when the underlying data reference changes.
 */
export function useHydratedConversationMessages(
  messages: UIMessage[],
  conversation: Conversation | null,
): UIMessage[] {
  const persistedToolCallLookupCacheRef = useRef<PersistedToolCallLookupCacheEntry | null>(null)
  const persistedToolCalls =
    persistedToolCallLookupCacheRef.current?.conversation === conversation
      ? persistedToolCallLookupCacheRef.current.lookup
      : (() => {
          const lookup = buildPersistedToolCallLookup(conversation)
          persistedToolCallLookupCacheRef.current = { conversation, lookup }
          return lookup
        })()

  const hydratedMessagesCacheRef = useRef<HydratedMessagesCacheEntry | null>(null)
  return hydratedMessagesCacheRef.current?.messages === messages &&
    hydratedMessagesCacheRef.current.lookup === persistedToolCalls
    ? hydratedMessagesCacheRef.current.result
    : (() => {
        const result = restorePersistedToolCallMetadataWithLookup(messages, persistedToolCalls)
        hydratedMessagesCacheRef.current = { messages, lookup: persistedToolCalls, result }
        return result
      })()
}
