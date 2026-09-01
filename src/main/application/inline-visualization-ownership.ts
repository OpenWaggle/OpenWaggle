import { SessionId } from '@shared/types/brand'
import type { SessionNode } from '@shared/types/session'
import { isRecord } from '@shared/utils/validation'
import type { AgentKernelSessionSnapshot } from '../ports/agent-kernel-service'

const VISUALIZE_REFERENCE_START = 'visualize'

function mergeVisualizationOwner(metadataJson: string, ownerSessionId: SessionId) {
  try {
    const parsed: unknown = JSON.parse(metadataJson)
    const metadata = isRecord(parsed) ? parsed : {}
    return JSON.stringify({ ...metadata, visualizationSessionId: ownerSessionId })
  } catch {
    return JSON.stringify({ visualizationSessionId: ownerSessionId })
  }
}

export function attributeCopiedVisualizationSources(
  snapshot: AgentKernelSessionSnapshot,
  sourceSession: {
    readonly id: SessionId
    readonly nodes: readonly Pick<SessionNode, 'id' | 'metadataJson'>[]
  },
): AgentKernelSessionSnapshot {
  const previousOwners = new Map(
    sourceSession.nodes.flatMap((node) => {
      try {
        const metadata: unknown = JSON.parse(node.metadataJson)
        if (isRecord(metadata) && typeof metadata.visualizationSessionId === 'string') {
          return [[String(node.id), SessionId(metadata.visualizationSessionId)] as const]
        }
      } catch {
        // Invalid historical metadata falls back to the source session owner.
      }
      return []
    }),
  )
  return {
    ...snapshot,
    nodes: snapshot.nodes.map((node) => {
      if (
        node.kind !== 'assistant_message' ||
        !node.contentJson.includes(VISUALIZE_REFERENCE_START)
      ) {
        return node
      }
      const ownerSessionId = previousOwners.get(node.id) ?? sourceSession.id
      return {
        ...node,
        metadataJson: mergeVisualizationOwner(node.metadataJson, ownerSessionId),
      }
    }),
  }
}
