import { SessionId } from '@shared/types/brand'
import type { SessionNode } from '@shared/types/session'
import { containsInlineVisualizationReference } from '@shared/utils/inline-visualization'
import { isRecord } from '@shared/utils/validation'
import type { AgentKernelSessionSnapshot } from '../ports/agent-kernel-service'

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
  /** The source node a copied node came from, when the copy has ids of its own. */
  sourceNodeIdByNodeId?: ReadonlyMap<string, string>,
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
        !containsInlineVisualizationReference(node.contentJson)
      ) {
        return node
      }
      const sourceNodeId = sourceNodeIdByNodeId?.get(node.id) ?? node.id
      // A copy of a copy keeps pointing at the Session that rendered the visualization.
      const ownerSessionId = previousOwners.get(sourceNodeId) ?? sourceSession.id
      return {
        ...node,
        metadataJson: mergeVisualizationOwner(node.metadataJson, ownerSessionId),
      }
    }),
  }
}
