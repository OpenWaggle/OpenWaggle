import type { UIMessage } from '@shared/types/chat-ui'

function userText(message: UIMessage) {
  return message.parts
    .flatMap((part) => (part.type === 'text' ? [part.content] : []))
    .join('\n')
    .trim()
}

/** Live user messages the transcript no longer shows under their own id, by text. */
function unmatchedLiveUsersByText(
  liveMessages: readonly UIMessage[],
  transcriptIds: ReadonlySet<string>,
) {
  const byText = new Map<string, string[]>()
  for (const message of liveMessages) {
    if (message.role !== 'user' || transcriptIds.has(message.id)) continue
    const text = userText(message)
    if (text) byText.set(text, [...(byText.get(text) ?? []), message.id])
  }
  return byText
}

/** Reconciliation records the persisted node on the live copy; that link is exact. */
function liveUserIdsByNode(liveMessages: readonly UIMessage[]) {
  const byNode = new Map<string, string>()
  for (const message of liveMessages) {
    const nodeId = message.metadata?.sessionNodeId
    if (message.role === 'user' && nodeId && nodeId !== message.id) byNode.set(nodeId, message.id)
  }
  return byNode
}

/**
 * Pairs each persisted user message with the optimistic copy the renderer showed before it.
 *
 * A turn's fold state is keyed by its user message id. When a run completes, the refreshed
 * workspace replaces the optimistic user message with its persisted node under a new id, so a turn
 * the reader had expanded collapsed about 35ms after it settled (seen in Electron QA). The live
 * message list keeps the optimistic id and records the persisted node on it.
 */
export function persistedUserMessageAliases(
  liveMessages: readonly UIMessage[],
  transcriptMessages: readonly UIMessage[],
) {
  const transcriptIds = new Set(transcriptMessages.map((message) => message.id))
  const liveIds = new Set(liveMessages.map((message) => message.id))
  const byText = unmatchedLiveUsersByText(liveMessages, transcriptIds)
  const byNode = liveUserIdsByNode(liveMessages)
  const aliases = new Map<string, string>()
  if (byText.size === 0 && byNode.size === 0) return aliases
  for (const message of transcriptMessages) {
    if (message.role !== 'user' || liveIds.has(message.id)) continue
    const liveId =
      byNode.get(message.metadata?.sessionNodeId ?? message.id) ??
      byNode.get(message.id) ??
      byText.get(userText(message))?.shift()
    if (liveId) aliases.set(message.id, liveId)
  }
  return aliases
}

/** Fold expansion recorded under either id of an aliased turn applies to both. */
export function expandedTurnKeysWithAliases(
  expanded: ReadonlySet<string>,
  aliases: ReadonlyMap<string, string>,
): ReadonlySet<string> {
  if (aliases.size === 0 || expanded.size === 0) return expanded
  let next: Set<string> | null = null
  for (const [persistedId, liveId] of aliases) {
    const expandedHere = expanded.has(persistedId) || expanded.has(liveId)
    if (!expandedHere || (expanded.has(persistedId) && expanded.has(liveId))) continue
    next ??= new Set(expanded)
    next.add(persistedId)
    next.add(liveId)
  }
  return next ?? expanded
}
