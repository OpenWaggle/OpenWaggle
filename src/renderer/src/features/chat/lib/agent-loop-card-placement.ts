import type { UIMessage } from '@shared/types/chat-ui'
import type { AgentTransportCustomEvent } from '@shared/types/stream'
import { agentLoopEventKey } from './agent-loop-transcript-events'
import { buildInteractionTranscriptItems } from './build-agent-loop-interaction-rows'
import { isToolResultOnlyMessage } from './chat-message-row-model'
import type { AgentInteractionEvent, ChatRow } from './types-chat-row'

/*
 * Agent-loop cards (interactions, notices, extension messages) sit in the transcript where they
 * happened, not stacked below the newest answer.
 *
 * A persisted card hangs from the end of the Run that recorded it, so its anchor message bounds it:
 * it never moves past its own Run. Within that bound it follows the last message created before
 * it: an approval asked for while a tool ran lands after that tool's call. A live card that is not
 * persisted yet has no anchor and is placed the same way from the newest message. Messages carry
 * Pi entry or Host event times and cards carry Host event times, so the two are comparable. A card
 * never separates a tool call from the results nested into it.
 */

type AgentLoopCardRow = Extract<
  ChatRow,
  { type: 'agent-loop-custom-message' | 'agent-loop-interaction' }
>

interface AgentLoopCard {
  readonly row: AgentLoopCardRow
  readonly key: string
  readonly timestamp: number
}

export interface AgentLoopCardPlacement {
  /**
   * Cards to render after the message at each index, oldest first; index -1 is before the first
   * message.
   */
  readonly afterMessageIndex: ReadonlyMap<number, readonly AgentLoopCardRow[]>
  /** Cards of a transcript without messages. */
  readonly withoutMessages: readonly AgentLoopCardRow[]
}

export const BEFORE_FIRST_MESSAGE = -1

const EMPTY_PLACEMENT: AgentLoopCardPlacement = {
  afterMessageIndex: new Map(),
  withoutMessages: [],
}

function agentLoopCards(
  customMessages: readonly AgentTransportCustomEvent[],
  interactionEvents: readonly AgentInteractionEvent[],
): AgentLoopCard[] {
  const cards: AgentLoopCard[] = [
    ...customMessages.map((event) => ({
      row: { type: 'agent-loop-custom-message' as const, event },
      key: agentLoopEventKey(event),
      timestamp: event.timestamp,
    })),
    ...buildInteractionTranscriptItems(interactionEvents).map((item) => ({
      row: { type: 'agent-loop-interaction' as const, item },
      key: agentLoopEventKey(item.request),
      timestamp: item.request.timestamp,
    })),
  ]
  // Stable, so cards recorded in the same millisecond keep their recorded order.
  return cards.sort((left, right) => left.timestamp - right.timestamp)
}

function messageIndexById(messages: readonly UIMessage[]) {
  const indexById = new Map<string, number>()
  for (const [index, message] of messages.entries()) {
    indexById.set(message.id, index)
    const nodeId = message.metadata?.sessionNodeId
    if (nodeId !== undefined) indexById.set(String(nodeId), index)
  }
  return indexById
}

function createdAfter(message: UIMessage | undefined, timestamp: number) {
  const createdAt = message?.createdAt?.getTime()
  return createdAt !== undefined && createdAt > timestamp
}

function placementIndex(messages: readonly UIMessage[], upperBound: number, timestamp: number) {
  let index = upperBound
  while (index > BEFORE_FIRST_MESSAGE && createdAfter(messages[index], timestamp)) index -= 1
  while (index + 1 < messages.length) {
    const next = messages[index + 1]
    if (!next || !isToolResultOnlyMessage(next)) break
    index += 1
  }
  return index
}

export function placeAgentLoopCards(input: {
  readonly messages: readonly UIMessage[]
  readonly customMessages: readonly AgentTransportCustomEvent[]
  readonly interactionEvents: readonly AgentInteractionEvent[]
  readonly anchorMessageIdByEventKey?: ReadonlyMap<string, string>
}): AgentLoopCardPlacement {
  const cards = agentLoopCards(input.customMessages, input.interactionEvents)
  if (cards.length === 0) return EMPTY_PLACEMENT
  if (input.messages.length === 0) {
    return { afterMessageIndex: new Map(), withoutMessages: cards.map((card) => card.row) }
  }

  const lastIndex = input.messages.length - 1
  const anchors = input.anchorMessageIdByEventKey
  const indexById = anchors && anchors.size > 0 ? messageIndexById(input.messages) : null
  const afterMessageIndex = new Map<number, AgentLoopCardRow[]>()
  for (const card of cards) {
    const anchorId = anchors?.get(card.key)
    const upperBound = (anchorId === undefined ? undefined : indexById?.get(anchorId)) ?? lastIndex
    const index = placementIndex(input.messages, upperBound, card.timestamp)
    const placed = afterMessageIndex.get(index)
    if (placed) placed.push(card.row)
    else afterMessageIndex.set(index, [card.row])
  }
  return { afterMessageIndex, withoutMessages: [] }
}
