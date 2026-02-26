import type { Conversation } from '@shared/types/conversation'
import type { WaggleConfig, WaggleMessageMetadata } from '@shared/types/waggle'
import type { UIMessage } from '@tanstack/ai-react'
import { useWaggleStore } from '@/stores/waggle-store'

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
): Record<string, WaggleMessageMetadata> {
  const activeConfig = useWaggleStore((s) => s.activeConfig)
  const completedTurnMeta = useWaggleStore((s) => s.completedTurnMeta)
  const status = useWaggleStore((s) => s.status)
  const currentAgentIndex = useWaggleStore((s) => s.currentAgentIndex)
  const currentAgentLabel = useWaggleStore((s) => s.currentAgentLabel)

  // Use the active config (live run) or the conversation's stored config (historical)
  const config: WaggleConfig | null | undefined = activeConfig ?? conversation?.waggleConfig

  if (!config) return {}

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

  return lookup
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
