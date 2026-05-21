import { parseJsonUnknown, safeDecodeUnknown } from '@shared/schema'
import { jsonObjectSchema } from '@shared/schemas/validation'
import { waggleMetadataSchema } from '@shared/schemas/waggle'
import type { Message } from '@shared/types/agent'
import { SupportedModelId } from '@shared/types/brand'
import type { SessionNode } from '@shared/types/session'
import type { WaggleMessageMetadata, WaggleStreamMetadata } from '@shared/types/waggle'
import { makeMessage } from '../../agent/shared'
import { createLogger } from '../../logger'
import type { AgentKernelSessionSnapshot } from '../../ports/agent-kernel-service'
import type { ProjectedSessionNodeInput } from '../../ports/session-repository'

const logger = createLogger('waggle-run-service')

export interface UnresolvedToolCall {
  readonly id: string
  readonly name: string
  readonly state?: 'input-complete'
}

const UNRESOLVED_TOOL_NAME_PREVIEW_COUNT = 3

export function tagAssistantMessages(messages: readonly Message[], meta: WaggleStreamMetadata) {
  return messages
    .filter((message) => message.role === 'assistant')
    .map((message) =>
      makeMessage('assistant', [...message.parts], message.model, {
        ...message.metadata,
        waggle: {
          agentIndex: meta.agentIndex,
          agentLabel: meta.agentLabel,
          agentColor: meta.agentColor,
          agentModel: meta.agentModel,
          turnNumber: meta.turnNumber,
          sessionId: meta.sessionId,
        },
      }),
    )
}

export function getUnresolvedToolCalls(message: Message) {
  const unresolvedById = new Map<string, Omit<UnresolvedToolCall, 'id'>>()

  for (const part of message.parts) {
    if (part.type !== 'tool-call') continue
    unresolvedById.set(String(part.toolCall.id), {
      name: part.toolCall.name,
      state: part.toolCall.state,
    })
  }

  for (const part of message.parts) {
    if (part.type === 'tool-result') unresolvedById.delete(String(part.toolResult.id))
  }

  return [...unresolvedById.entries()].map(([id, data]) => ({ id, ...data }))
}

export function summarizeUnresolvedTools(unresolvedToolCalls: readonly UnresolvedToolCall[]) {
  const unresolvedToolNames = unresolvedToolCalls
    .slice(0, UNRESOLVED_TOOL_NAME_PREVIEW_COUNT)
    .map((toolCall) => toolCall.name)
    .join(', ')
  const moreToolsCount = unresolvedToolCalls.length - UNRESOLVED_TOOL_NAME_PREVIEW_COUNT
  return moreToolsCount > 0
    ? `${unresolvedToolNames} (+${String(moreToolsCount)} more)`
    : unresolvedToolNames
}

export function toWaggleMessageMetadata(meta: WaggleStreamMetadata) {
  return {
    agentIndex: meta.agentIndex,
    agentLabel: meta.agentLabel,
    agentColor: meta.agentColor,
    agentModel: meta.agentModel,
    turnNumber: meta.turnNumber,
    sessionId: meta.sessionId,
  }
}

function parseMetadataJson(raw: string, nodeId: string) {
  try {
    const parsed = parseJsonUnknown(raw)
    const result = safeDecodeUnknown(jsonObjectSchema, parsed)
    if (!result.success) {
      logger.warn('Ignoring invalid session node metadata JSON', {
        nodeId,
        issues: result.issues.join('; '),
      })
      return {}
    }
    return result.data
  } catch (error) {
    logger.warn('Failed to parse session node metadata JSON', {
      nodeId,
      error: error instanceof Error ? error.message : String(error),
    })
    return {}
  }
}

function extractWaggleMetadata(node: SessionNode) {
  const metadata = parseMetadataJson(node.metadataJson, String(node.id))
  const waggle = metadata.waggle
  if (waggle === undefined) {
    return null
  }
  const parsed = safeDecodeUnknown(waggleMetadataSchema, waggle)
  if (!parsed.success) {
    logger.warn('Ignoring invalid Waggle metadata on session node', {
      nodeId: String(node.id),
      issues: parsed.issues.join('; '),
    })
    return null
  }

  const agentModel = parsed.data.agentModel ? SupportedModelId(parsed.data.agentModel) : undefined

  return {
    agentIndex: parsed.data.agentIndex,
    agentLabel: parsed.data.agentLabel,
    agentColor: parsed.data.agentColor,
    ...(agentModel ? { agentModel } : {}),
    turnNumber: parsed.data.turnNumber,
    ...(parsed.data.sessionId ? { sessionId: parsed.data.sessionId } : {}),
  }
}

export function seedWaggleMetadataFromTree(nodes: readonly SessionNode[]) {
  const metadataByNodeId = new Map<string, WaggleMessageMetadata>()
  for (const node of nodes) {
    if (node.kind !== 'assistant_message') continue
    const metadata = extractWaggleMetadata(node)
    if (metadata) metadataByNodeId.set(String(node.id), metadata)
  }
  return metadataByNodeId
}

function applyMetadataToNode(node: ProjectedSessionNodeInput, meta: WaggleMessageMetadata) {
  return {
    ...node,
    metadataJson: JSON.stringify({
      ...parseMetadataJson(node.metadataJson, node.id),
      waggle: waggleMetadataToJson(meta),
    }),
  }
}

function waggleMetadataToJson(meta: WaggleMessageMetadata) {
  return {
    agentIndex: meta.agentIndex,
    agentLabel: meta.agentLabel,
    agentColor: meta.agentColor,
    ...(meta.agentModel ? { agentModel: String(meta.agentModel) } : {}),
    turnNumber: meta.turnNumber,
    ...(meta.sessionId ? { sessionId: meta.sessionId } : {}),
  }
}

export function applyWaggleMetadataToSnapshot(input: {
  readonly snapshot: AgentKernelSessionSnapshot
  readonly metadataByNodeId: Map<string, WaggleMessageMetadata>
  readonly knownNodeIds: Set<string>
  readonly newTurnMetadata: readonly WaggleMessageMetadata[]
}) {
  let newMetadataIndex = 0
  const nextNodes = input.snapshot.nodes.map((node) => {
    const wasKnown = input.knownNodeIds.has(node.id)
    input.knownNodeIds.add(node.id)

    if (node.kind !== 'assistant_message') return node
    const existingMeta = input.metadataByNodeId.get(node.id)
    if (existingMeta) return applyMetadataToNode(node, existingMeta)
    if (wasKnown) return node

    const metadata = input.newTurnMetadata[newMetadataIndex]
    newMetadataIndex += 1
    if (!metadata) return node

    input.metadataByNodeId.set(node.id, metadata)
    return applyMetadataToNode(node, metadata)
  })

  return { ...input.snapshot, nodes: nextNodes }
}

export function extractFilePath(input: unknown) {
  if (input == null || typeof input !== 'object') return ''
  const path = 'path' in input ? input.path : 'filePath' in input ? input.filePath : ''
  return typeof path === 'string' ? path : ''
}
