import type { UIMessage } from '@shared/types/chat-ui'
import type { Conversation } from '@shared/types/conversation'
import type { WaggleConfig, WaggleMessageMetadata } from '@shared/types/waggle'
import { useWaggleStore } from '@/stores/waggle-store'

const EMPTY_WAGGLE_METADATA_LOOKUP: Readonly<Record<string, WaggleMessageMetadata>> = Object.freeze(
  {},
)

/**
 * Derives a UIMessage-id -> Waggle metadata lookup.
 *
 * During live streaming, prefers `liveMessageMetadata` (built from
 * `waggle:event` message-start transport events). This keeps agent
 * attribution accurate even if multiple assistant UIMessages are emitted
 * within the same turn.
 *
 * Falls back to `completedTurnMeta` (ordered turn-end metadata) and then
 * to `initialTurnMeta` / current-agent hints when a live mapping is missing.
 *
 * For reloaded sessions, uses persisted per-message metadata when available,
 * including synthesis messages.
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

  // Use the active config only for the owning conversation; others use persisted waggleConfig.
  // When owningId is null (config set before conversation exists), apply to current view.
  const owningId = activeCollaborationId ?? configConversationId
  const liveConfig = !owningId || owningId === conversation?.id ? activeConfig : null
  const config: WaggleConfig | null | undefined = liveConfig ?? conversation?.waggleConfig

  if (!config) {
    return EMPTY_WAGGLE_METADATA_LOOKUP
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
        assistantIndex++
        continue
      }

      // Fallback for messages that already completed and have turn-end metadata.
      const completedMeta =
        assistantIndex < completedTurnMeta.length ? completedTurnMeta[assistantIndex] : undefined
      if (completedMeta) {
        lookup[msg.id] = completedMeta
        assistantIndex++
        continue
      }

      // Very first turn is still streaming — use the stable initial metadata
      // instead of currentAgentIndex which may have already advanced.
      if (completedTurnMeta.length === 0 && initialTurnMeta) {
        lookup[msg.id] = initialTurnMeta
        assistantIndex++
        continue
      }

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
        assistantIndex++
        continue
      }

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
      assistantIndex++
      continue
    }

    // Historical or early streaming (no completed turns yet):
    // Only use persisted per-message metadata. No position-based fallback —
    // messages without metadata.waggle are standard messages and should not
    // receive waggle styling, even if the conversation has a waggleConfig.
    const persisted = persistedMeta.get(assistantIndex)
    if (persisted) {
      lookup[msg.id] = persisted
    }

    assistantIndex++
  }

  return Object.freeze(lookup)
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
