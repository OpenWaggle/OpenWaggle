import type { SessionWorkspace } from '@shared/types/session'
import type { AgentTransportCustomEvent } from '@shared/types/stream'
import {
  type AgentLoopTranscriptNode,
  isAgentLoopTranscriptNode,
  readAgentLoopEventFromNode,
} from './agent-loop-transcript-event-parser'
import type { AgentInteractionEvent } from './types-chat-row'

interface AgentLoopTranscriptEvents {
  readonly customMessages: readonly AgentTransportCustomEvent[]
  readonly interactionEvents: readonly AgentInteractionEvent[]
  /**
   * The transcript message each persisted event follows, by `agentLoopEventKey`: the message of
   * the transcript-path entry its audit chain hangs from (the end of the Run that recorded it).
   */
  readonly anchorMessageIdByEventKey: ReadonlyMap<string, string>
}

function readAgentLoopEventsFromNodes(
  nodes: readonly AgentLoopTranscriptNode[],
  anchorMessageIdForNode: (node: AgentLoopTranscriptNode) => string | null,
): AgentLoopTranscriptEvents {
  const customMessages: AgentTransportCustomEvent[] = []
  const interactionEvents: AgentInteractionEvent[] = []
  const anchorMessageIdByEventKey = new Map<string, string>()

  for (const node of nodes) {
    const event = readAgentLoopEventFromNode(node)
    if (event === null) {
      continue
    }

    if (event.type === 'custom') {
      customMessages.push(event)
    } else {
      interactionEvents.push(event)
    }
    const anchor = anchorMessageIdForNode(node)
    if (anchor !== null) anchorMessageIdByEventKey.set(agentLoopEventKey(event), anchor)
  }

  return { customMessages, interactionEvents, anchorMessageIdByEventKey }
}

function compareWorkspaceNodes(left: AgentLoopTranscriptNode, right: AgentLoopTranscriptNode) {
  return left.timestampMs - right.timestampMs || left.createdOrder - right.createdOrder
}

/** The transcript-path entry an audit node's chain hangs from, or null when it is off the path. */
function transcriptPathAnchorId(input: {
  readonly node: AgentLoopTranscriptNode
  readonly nodeById: ReadonlyMap<string, AgentLoopTranscriptNode>
  readonly pathIndexById: ReadonlyMap<string, number>
}) {
  const visited = new Set<string>()
  let parentId = input.node.parentId

  while (parentId) {
    if (input.pathIndexById.has(parentId)) {
      return parentId
    }
    if (visited.has(parentId)) {
      return null
    }
    visited.add(parentId)

    const parent = input.nodeById.get(parentId)
    if (!parent || !isAgentLoopTranscriptNode(parent)) {
      return null
    }
    parentId = parent.parentId
  }

  return null
}

/** The nearest transcript-path entry at or before `index` that is shown as a message. */
function messageAtOrBefore(path: SessionWorkspace['transcriptPath'], index: number) {
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const node = path[cursor]?.node
    if (node?.message) return String(node.id)
  }
  return null
}

export function readAgentLoopEventsFromWorkspace(
  workspace: SessionWorkspace,
): AgentLoopTranscriptEvents {
  const path = workspace.transcriptPath
  const pathIndexById = new Map(path.map((entry, index) => [String(entry.node.id), index]))
  const nodeById = new Map(workspace.tree.nodes.map((node) => [String(node.id), node]))
  const anchorIdByNodeId = new Map<string, string>()
  const visibleNodes = workspace.tree.nodes.filter((node) => {
    const nodeId = String(node.id)
    if (pathIndexById.has(nodeId)) return true
    const anchorId = transcriptPathAnchorId({ node, nodeById, pathIndexById })
    if (anchorId === null) return false
    anchorIdByNodeId.set(nodeId, anchorId)
    return true
  })

  return readAgentLoopEventsFromNodes([...visibleNodes].sort(compareWorkspaceNodes), (node) => {
    const index = pathIndexById.get(anchorIdByNodeId.get(node.id) ?? node.id)
    return index === undefined ? null : messageAtOrBefore(path, index)
  })
}

function customMessageKey(event: AgentTransportCustomEvent) {
  return `${event.timestamp}:${event.name}:${JSON.stringify(event.value ?? null)}`
}

function interactionEventKey(event: AgentInteractionEvent) {
  return event.type === 'agent_interaction_request'
    ? `request:${String(event.interaction.sessionId)}:${event.interaction.runId}:${
        event.interaction.interactionId
      }`
    : `resolved:${event.runId}:${event.interactionId}:${event.status}`
}

/** One key per agent-loop event; a live event and its persisted copy share it. */
export function agentLoopEventKey(event: AgentTransportCustomEvent | AgentInteractionEvent) {
  return event.type === 'custom' ? customMessageKey(event) : interactionEventKey(event)
}

export function mergeCustomMessages(
  persisted: readonly AgentTransportCustomEvent[],
  live: readonly AgentTransportCustomEvent[],
) {
  const eventsByKey = new Map(persisted.map((event) => [customMessageKey(event), event]))
  for (const event of live) {
    eventsByKey.set(customMessageKey(event), event)
  }
  return [...eventsByKey.values()].sort((left, right) => left.timestamp - right.timestamp)
}

export function mergeInteractionEvents(
  persisted: readonly AgentInteractionEvent[],
  live: readonly AgentInteractionEvent[],
) {
  const eventsByKey = new Map(persisted.map((event) => [interactionEventKey(event), event]))
  for (const event of live) {
    eventsByKey.set(interactionEventKey(event), event)
  }
  return [...eventsByKey.values()].sort((left, right) => left.timestamp - right.timestamp)
}
