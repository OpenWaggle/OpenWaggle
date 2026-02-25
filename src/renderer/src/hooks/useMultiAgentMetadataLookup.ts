import type { Conversation } from '@shared/types/conversation'
import type { MultiAgentConfig, MultiAgentMessageMetadata } from '@shared/types/multi-agent'
import type { UIMessage } from '@tanstack/ai-react'
import { useMultiAgentStore } from '@/stores/multi-agent-store'

/**
 * Derives a UIMessage-id → multi-agent metadata lookup.
 *
 * During live streaming, uses `completedTurnMeta` from the store — an ordered
 * list built from `turn-end` events which only fire for successful turns.
 * This correctly handles failed turns (e.g. API credit errors) because they
 * never emit `turn-end` and don't create UIMessages with text content.
 *
 * For the in-progress turn (last assistant message, no `turn-end` yet), falls
 * back to the store's `currentAgentIndex` / `currentAgentLabel`.
 *
 * For historical (reloaded) conversations, uses persisted `metadata.multiAgent`
 * when available (handles synthesis messages correctly), with position-based
 * derivation as fallback for older conversations.
 */
export function useMultiAgentMetadataLookup(
  conversation: Conversation | null,
  messages: UIMessage[],
): Record<string, MultiAgentMessageMetadata> {
  const activeConfig = useMultiAgentStore((s) => s.activeConfig)
  const completedTurnMeta = useMultiAgentStore((s) => s.completedTurnMeta)
  const status = useMultiAgentStore((s) => s.status)
  const currentAgentIndex = useMultiAgentStore((s) => s.currentAgentIndex)
  const currentAgentLabel = useMultiAgentStore((s) => s.currentAgentLabel)

  // Use the active config (live run) or the conversation's stored config (historical)
  const config: MultiAgentConfig | null | undefined = activeConfig ?? conversation?.multiAgentConfig

  if (!config) return {}

  const lookup: Record<string, MultiAgentMessageMetadata> = {}
  const isLive = status === 'running'

  // Build a map of persisted multi-agent metadata indexed by assistant position.
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

  return lookup
}

/**
 * Extract persisted multi-agent metadata from conversation messages,
 * indexed by assistant message position. Returns an empty map if
 * no conversation or no multiAgent metadata is found.
 */
function buildPersistedMetaMap(
  conversation: Conversation | null,
): Map<number, MultiAgentMessageMetadata> {
  const map = new Map<number, MultiAgentMessageMetadata>()
  if (!conversation) return map

  let assistantIdx = 0
  for (const msg of conversation.messages) {
    if (msg.role !== 'assistant') continue
    const meta = msg.metadata?.multiAgent
    if (meta) {
      map.set(assistantIdx, meta)
    }
    assistantIdx++
  }

  return map
}
