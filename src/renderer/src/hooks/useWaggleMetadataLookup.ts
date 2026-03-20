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
 * During live streaming, prefers `liveMessageMetadata` (built from
 * `waggle:stream-chunk` TEXT_MESSAGE_START events). This keeps agent
 * attribution accurate even if multiple assistant UIMessages are emitted
 * within the same turn.
 *
 * Falls back to `completedTurnMeta` (ordered turn-end metadata) and then
 * to `initialTurnMeta` / current-agent hints when a live mapping is missing.
 *
 * For historical (reloaded) conversations, uses persisted metadata when
 * available (including synthesis), with position-based derivation only as
 * a legacy fallback for older conversations.
 */
export function useWaggleMetadataLookup(
  conversation: Conversation | null,
  messages: UIMessage[],
): Readonly<Record<string, WaggleMessageMetadata>> {
  const activeConfig = useWaggleStore((s) => s.activeConfig)
  const activeCollaborationId = useWaggleStore((s) => s.activeCollaborationId)
  const configConversationId = useWaggleStore((s) => s.configConversationId)
  const completedTurnMeta = useWaggleStore((s) => s.completedTurnMeta)
  const initialTurnMeta = useWaggleStore((s) => s.initialTurnMeta)
  const liveMessageMetadata = useWaggleStore((s) => s.liveMessageMetadata)
  const status = useWaggleStore((s) => s.status)
  const currentAgentIndex = useWaggleStore((s) => s.currentAgentIndex)
  const currentAgentLabel = useWaggleStore((s) => s.currentAgentLabel)
  const cacheRef = useRef<{
    conversation: Conversation | null
    messages: UIMessage[]
    config: WaggleConfig | null | undefined
    liveMessageMetadata: Readonly<Record<string, WaggleMessageMetadata>>
    completedTurnMeta: readonly WaggleMessageMetadata[]
    initialTurnMeta: WaggleMessageMetadata | null
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
      liveMessageMetadata,
      completedTurnMeta,
      initialTurnMeta,
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
    cacheRef.current.liveMessageMetadata === liveMessageMetadata &&
    cacheRef.current.completedTurnMeta === completedTurnMeta &&
    cacheRef.current.initialTurnMeta === initialTurnMeta &&
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

    if (isLive) {
      const liveMeta = liveMessageMetadata[msg.id]
      if (liveMeta) {
        // Live streaming: prefer per-message metadata from stream chunks.
        lookup[msg.id] = liveMeta
      } else if (assistantIndex < completedTurnMeta.length) {
        // Fallback for messages that already completed and have turn-end metadata.
        const meta = completedTurnMeta[assistantIndex]
        if (meta) {
          lookup[msg.id] = meta
        }
      } else if (completedTurnMeta.length === 0 && initialTurnMeta) {
        // Very first turn is still streaming — use the stable initial metadata
        // instead of currentAgentIndex which may have already advanced.
        lookup[msg.id] = initialTurnMeta
      } else {
        // In-progress turn (last assistant message) — use current agent from store
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
      // Prefer persisted metadata (handles synthesis).
      // Position-based fallback only applies to legacy conversations that have
      // zero persisted waggle metadata. When at least one message has persisted
      // waggle metadata, messages without it are post-waggle standard messages
      // and should not receive waggle styling.
      const persisted = persistedMeta.get(assistantIndex)
      if (persisted) {
        lookup[msg.id] = persisted
      } else if (persistedMeta.size === 0) {
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
    liveMessageMetadata,
    completedTurnMeta,
    initialTurnMeta,
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
