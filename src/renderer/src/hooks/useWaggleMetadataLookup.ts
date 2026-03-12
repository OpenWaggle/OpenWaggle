import type { Conversation } from '@shared/types/conversation'
import type { WaggleConfig, WaggleMessageMetadata } from '@shared/types/waggle'
import type { UIMessage } from '@tanstack/ai-react'
import { useRef } from 'react'
import { useWaggleStore } from '@/stores/waggle-store'

const EMPTY_WAGGLE_METADATA_LOOKUP: Readonly<Record<string, WaggleMessageMetadata>> = Object.freeze(
  {},
)

/**
 * Derives a UIMessage-id -> Waggle metadata lookup.
 *
 * During live streaming, uses `completedTurnMeta` from the store — an ordered
 * list built from `turn-end` events which only fire for successful turns.
 * This correctly handles failed turns (e.g. API credit errors) because they
 * never emit `turn-end` and don't create UIMessages with text content.
 *
 * For the in-progress turn (last assistant message, no `turn-end` yet), falls
 * back to the store's `currentAgentIndex` / `currentAgentLabel`.
 *
 * For historical (reloaded) conversations, uses persisted `metadata.waggle`
 * when available (handles synthesis messages correctly), with position-based
 * derivation as fallback for older conversations.
 */
export function useWaggleMetadataLookup(
  conversation: Conversation | null,
  messages: UIMessage[],
): Readonly<Record<string, WaggleMessageMetadata>> {
  const activeConfig = useWaggleStore((s) => s.activeConfig)
  const activeCollaborationId = useWaggleStore((s) => s.activeCollaborationId)
  const configConversationId = useWaggleStore((s) => s.configConversationId)
  const completedTurnMeta = useWaggleStore((s) => s.completedTurnMeta)
  const status = useWaggleStore((s) => s.status)
  const currentAgentIndex = useWaggleStore((s) => s.currentAgentIndex)
  const currentAgentLabel = useWaggleStore((s) => s.currentAgentLabel)
  const cacheRef = useRef<{
    conversation: Conversation | null
    messages: UIMessage[]
    config: WaggleConfig | null | undefined
    completedTurnMeta: readonly WaggleMessageMetadata[]
    status: string
    currentAgentIndex: number
    currentAgentLabel: string
    lookup: Readonly<Record<string, WaggleMessageMetadata>>
  } | null>(null)

  // Use the active config only for the owning conversation; others use persisted waggleConfig.
  // When owningId is null (config set before conversation exists), apply to current view.
  const owningId = activeCollaborationId ?? configConversationId
  const liveConfig = !owningId || owningId === conversation?.id ? activeConfig : null
  const config: WaggleConfig | null | undefined = liveConfig ?? conversation?.waggleConfig

  if (!config) {
    cacheRef.current = {
      conversation,
      messages,
      config,
      completedTurnMeta,
      status,
      currentAgentIndex,
      currentAgentLabel,
      lookup: EMPTY_WAGGLE_METADATA_LOOKUP,
    }
    return EMPTY_WAGGLE_METADATA_LOOKUP
  }

  if (
    cacheRef.current?.conversation === conversation &&
    cacheRef.current.messages === messages &&
    cacheRef.current.config === config &&
    cacheRef.current.completedTurnMeta === completedTurnMeta &&
    cacheRef.current.status === status &&
    cacheRef.current.currentAgentIndex === currentAgentIndex &&
    cacheRef.current.currentAgentLabel === currentAgentLabel
  ) {
    return cacheRef.current.lookup
  }

  const lookup: Record<string, WaggleMessageMetadata> = {}
  const isLive = status === 'running'

  // Build a map of persisted Waggle metadata indexed by assistant position.
  // This handles synthesis messages and any metadata persisted on disk.
  const persistedMeta = buildPersistedMetaMap(conversation)

  let assistantIndex = 0
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue

    if (isLive && completedTurnMeta.length > 0) {
      // Live streaming: use tracked metadata for completed turns
      if (assistantIndex < completedTurnMeta.length) {
        const meta = completedTurnMeta[assistantIndex]
        if (meta) {
          lookup[msg.id] = meta
        }
      } else {
        // In-progress turn — no turn-end yet, use current agent from store
        const isSynthesis = currentAgentIndex === -1
        if (isSynthesis) {
          lookup[msg.id] = {
            agentIndex: -1,
            agentLabel: 'Synthesis',
            agentColor: 'emerald',
            agentModel: config.agents[0].model,
            turnNumber: completedTurnMeta.length,
            isSynthesis: true,
          }
        } else {
          const agent = config.agents[currentAgentIndex]
          if (agent) {
            lookup[msg.id] = {
              agentIndex: currentAgentIndex,
              agentLabel: currentAgentLabel,
              agentColor: agent.color,
              agentModel: agent.model,
              turnNumber: completedTurnMeta.length,
            }
          }
        }
      }
    } else {
      // Historical or early streaming (no completed turns yet):
      // Prefer persisted metadata (handles synthesis), fall back to position-based
      const persisted = persistedMeta.get(assistantIndex)
      if (persisted) {
        lookup[msg.id] = persisted
      } else {
        const agentIdx = assistantIndex % config.agents.length
        const agent = config.agents[agentIdx]
        if (agent) {
          lookup[msg.id] = {
            agentIndex: agentIdx,
            agentLabel: agent.label,
            agentColor: agent.color,
            agentModel: agent.model,
            turnNumber: assistantIndex,
          }
        }
      }
    }

    assistantIndex++
  }

  const stableLookup = Object.freeze(lookup)
  cacheRef.current = {
    conversation,
    messages,
    config,
    completedTurnMeta,
    status,
    currentAgentIndex,
    currentAgentLabel,
    lookup: stableLookup,
  }
  return stableLookup
}

/**
 * Extract persisted Waggle metadata from conversation messages,
 * indexed by assistant message position. Returns an empty map if
 * no conversation or no Waggle metadata is found.
 */
function buildPersistedMetaMap(
  conversation: Conversation | null,
): Map<number, WaggleMessageMetadata> {
  const map = new Map<number, WaggleMessageMetadata>()
  if (!conversation) return map

  let assistantIdx = 0
  for (const msg of conversation.messages) {
    if (msg.role !== 'assistant') continue
    const meta = msg.metadata?.waggle
    if (meta) {
      map.set(assistantIdx, meta)
    }
    assistantIdx++
  }

  return map
}
