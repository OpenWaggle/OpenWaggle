import { OPENWAGGLE_AGENT_LOOP } from '@shared/constants/agent-loop'
import type {
  AgentTransportCustomEvent,
  AgentTransportEvent,
  AgentTransportInteractionRequestEvent,
  AgentTransportInteractionResolvedEvent,
} from '@shared/types/stream'
import type { AgentKernelSessionSnapshot } from '../../ports/agent-kernel-service'
import type { ProjectedSessionNodeInput } from '../../ports/session-repository'

const DECIMAL_RADIX = 10

export type DurableAgentLoopEvent =
  | AgentTransportCustomEvent
  | AgentTransportInteractionRequestEvent
  | AgentTransportInteractionResolvedEvent

export interface DurableAgentLoopEventNodeContent {
  readonly customType: typeof OPENWAGGLE_AGENT_LOOP.SESSION_EVENT_CUSTOM_TYPE
  readonly event: DurableAgentLoopEvent
}

interface DurableAgentLoopNodeSource {
  readonly id: string
  readonly parentId: string | null
  readonly piEntryType: string
  readonly kind: string
  readonly role?: ProjectedSessionNodeInput['role']
  readonly timestampMs: number
  readonly contentJson: string
  readonly metadataJson: string
  readonly pathDepth: number
  readonly createdOrder: number
}

type UnknownObject = { readonly [key: string]: unknown }

export function isDurableAgentLoopEvent(
  event: AgentTransportEvent,
): event is DurableAgentLoopEvent {
  return (
    event.type === 'custom' ||
    event.type === 'agent_interaction_request' ||
    event.type === 'agent_interaction_resolved'
  )
}

function isObject(value: unknown): value is UnknownObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJsonObject(raw: string): UnknownObject | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    return isObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isDurableAgentLoopNode(node: DurableAgentLoopNodeSource) {
  if (node.kind !== 'custom') {
    return false
  }

  const content = parseJsonObject(node.contentJson)
  return content?.customType === OPENWAGGLE_AGENT_LOOP.SESSION_EVENT_CUSTOM_TYPE
}

function nextCreatedOrder(nodes: readonly ProjectedSessionNodeInput[]) {
  return nodes.reduce((max, node) => Math.max(max, node.createdOrder), -1) + 1
}

function nextPathDepth(nodes: readonly ProjectedSessionNodeInput[], activeNodeId: string | null) {
  const activeNode = activeNodeId ? nodes.find((node) => node.id === activeNodeId) : undefined
  return (activeNode?.pathDepth ?? -1) + 1
}

function nextAgentLoopEventIndex(nodes: readonly ProjectedSessionNodeInput[], runId: string) {
  const prefix = `${runId}:agent-loop:`
  let maxIndex = -1

  for (const node of nodes) {
    if (!node.id.startsWith(prefix)) {
      continue
    }

    const index = Number.parseInt(node.id.slice(prefix.length), DECIMAL_RADIX)
    if (Number.isInteger(index)) {
      maxIndex = Math.max(maxIndex, index)
    }
  }

  return maxIndex + 1
}

function agentLoopEventNode(input: {
  readonly event: DurableAgentLoopEvent
  readonly runId: string
  readonly index: number
  readonly parentId: string | null
  readonly pathDepth: number
  readonly createdOrder: number
}): ProjectedSessionNodeInput {
  const content: DurableAgentLoopEventNodeContent = {
    customType: OPENWAGGLE_AGENT_LOOP.SESSION_EVENT_CUSTOM_TYPE,
    event: input.event,
  }
  return {
    id: `${input.runId}:agent-loop:${String(input.index)}`,
    parentId: input.parentId,
    piEntryType: 'custom',
    kind: 'custom',
    role: null,
    timestampMs: input.event.timestamp,
    contentJson: JSON.stringify(content),
    metadataJson: JSON.stringify({
      customType: OPENWAGGLE_AGENT_LOOP.SESSION_EVENT_CUSTOM_TYPE,
    }),
    pathDepth: input.pathDepth,
    createdOrder: input.createdOrder,
  }
}

function carriedDurableAgentLoopNode(input: {
  readonly node: DurableAgentLoopNodeSource
  readonly createdOrder: number
}): ProjectedSessionNodeInput {
  return {
    id: input.node.id,
    parentId: input.node.parentId,
    piEntryType: input.node.piEntryType,
    kind: 'custom',
    role: null,
    timestampMs: input.node.timestampMs,
    contentJson: input.node.contentJson,
    metadataJson: input.node.metadataJson,
    pathDepth: input.node.pathDepth,
    createdOrder: input.createdOrder,
  }
}

function appendExistingDurableAgentLoopNodes(input: {
  readonly nodes: ProjectedSessionNodeInput[]
  readonly existingNodes: readonly DurableAgentLoopNodeSource[]
}) {
  const nodeIds = new Set(input.nodes.map((node) => node.id))
  let createdOrder = nextCreatedOrder(input.nodes)

  for (const node of input.existingNodes) {
    if (!isDurableAgentLoopNode(node) || nodeIds.has(node.id)) {
      continue
    }

    input.nodes.push(carriedDurableAgentLoopNode({ node, createdOrder }))
    nodeIds.add(node.id)
    createdOrder += 1
  }

  return createdOrder
}

export function appendDurableAgentLoopEvents(input: {
  readonly snapshot: AgentKernelSessionSnapshot
  readonly events: readonly DurableAgentLoopEvent[]
  readonly runId: string
  readonly existingNodes?: readonly DurableAgentLoopNodeSource[]
}): AgentKernelSessionSnapshot {
  const nodes = [...input.snapshot.nodes]
  let createdOrder = appendExistingDurableAgentLoopNodes({
    nodes,
    existingNodes: input.existingNodes ?? [],
  })

  if (input.events.length === 0) {
    return nodes.length === input.snapshot.nodes.length
      ? input.snapshot
      : {
          nodes,
          activeNodeId: input.snapshot.activeNodeId,
        }
  }

  const nodeIds = new Set(nodes.map((node) => node.id))
  let parentId = input.snapshot.activeNodeId
  let pathDepth = nextPathDepth(nodes, input.snapshot.activeNodeId)
  let eventIndex = nextAgentLoopEventIndex(nodes, input.runId)

  for (const event of input.events) {
    let node = agentLoopEventNode({
      event,
      runId: input.runId,
      index: eventIndex,
      parentId,
      pathDepth,
      createdOrder,
    })
    while (nodeIds.has(node.id)) {
      eventIndex += 1
      node = agentLoopEventNode({
        event,
        runId: input.runId,
        index: eventIndex,
        parentId,
        pathDepth,
        createdOrder,
      })
    }
    nodes.push(node)
    nodeIds.add(node.id)
    parentId = node.id
    pathDepth += 1
    createdOrder += 1
    eventIndex += 1
  }

  return {
    nodes,
    activeNodeId: input.snapshot.activeNodeId,
  }
}
