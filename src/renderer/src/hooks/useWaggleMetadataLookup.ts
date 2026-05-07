import type { UIMessage } from '@shared/types/chat-ui'
import type { SessionDetail } from '@shared/types/session'
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
 * For reloaded sessions, uses persisted per-message metadata when available.
 */
export function useWaggleMetadataLookup(
  session: SessionDetail | null,
  messages: UIMessage[],
): Readonly<Record<string, WaggleMessageMetadata>> {
  const activeConfig = useWaggleStore((s) => s.activeConfig)
  const activeCollaborationId = useWaggleStore((s) => s.activeCollaborationId)
  const configSessionId = useWaggleStore((s) => s.configSessionId)
  const completedTurnMeta = useWaggleStore((s) => s.completedTurnMeta)
  const initialTurnMeta = useWaggleStore((s) => s.initialTurnMeta)
  const liveMessageMetadata = useWaggleStore((s) => s.liveMessageMetadata)
  const status = useWaggleStore((s) => s.status)
  const currentAgentIndex = useWaggleStore((s) => s.currentAgentIndex)
  const currentAgentLabel = useWaggleStore((s) => s.currentAgentLabel)

  // Use the active config only for the owning session; others use persisted waggleConfig.
  // When owningId is null (config set before session exists), apply to current view.
  const owningId = activeCollaborationId ?? configSessionId
  const liveConfig = !owningId || owningId === session?.id ? activeConfig : null
  const config: WaggleConfig | null | undefined = liveConfig ?? session?.waggleConfig

  if (!config) {
    return EMPTY_WAGGLE_METADATA_LOOKUP
  }

  const lookup: Record<string, WaggleMessageMetadata> = {}
  const isLive = status === 'running'
  let lastUserMessageIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      lastUserMessageIndex = index
      break
    }
  }

  // Build a map of persisted Waggle metadata by message id. Position-based
  // attribution breaks when transcript projection hides or nests tool results.
  const persistedMeta = buildPersistedMetaMap(session)

  let assistantIndex = 0
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const msg = messages[messageIndex]
    if (!msg) continue
    if (msg.role !== 'assistant') continue

    if (isLive) {
      const liveMeta = liveMessageMetadata[msg.id]
      if (liveMeta) {
        // Live streaming: prefer per-message metadata from stream chunks.
        lookup[msg.id] = liveMeta
        assistantIndex++
        continue
      }

      const persisted = persistedMeta.get(msg.id)
      if (persisted) {
        lookup[msg.id] = persisted
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
      if (
        messageIndex > lastUserMessageIndex &&
        completedTurnMeta.length === 0 &&
        initialTurnMeta
      ) {
        lookup[msg.id] = initialTurnMeta
        assistantIndex++
        continue
      }

      // In-progress turn (last assistant message) — use current agent from store.
      const agent = config.agents[currentAgentIndex]
      if (messageIndex > lastUserMessageIndex && agent) {
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
    // receive waggle styling, even if the session has a waggleConfig.
    const persisted = persistedMeta.get(msg.id)
    if (persisted) {
      lookup[msg.id] = persisted
    }

    assistantIndex++
  }

  return Object.freeze(lookup)
}

/**
 * Extract persisted Waggle metadata from session messages by message id.
 * Returns an empty map if no session or no Waggle metadata is found.
 */
function buildPersistedMetaMap(session: SessionDetail | null): Map<string, WaggleMessageMetadata> {
  const map = new Map<string, WaggleMessageMetadata>()
  if (!session) return map

  for (const msg of session.messages) {
    if (msg.role !== 'assistant') continue
    const meta = msg.metadata?.waggle
    if (meta) {
      map.set(String(msg.id), meta)
    }
  }

  return map
}
