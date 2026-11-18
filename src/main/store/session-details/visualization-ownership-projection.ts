import { containsInlineVisualizationReference } from '@shared/utils/inline-visualization'
import type { ProjectedSessionNodeInput } from '../../ports/session-repository'

function readVisualizationOwner(metadataJson: string) {
  try {
    const value: unknown = JSON.parse(metadataJson)
    if (
      typeof value === 'object' &&
      value !== null &&
      'visualizationSessionId' in value &&
      typeof value.visualizationSessionId === 'string'
    ) {
      return value.visualizationSessionId
    }
  } catch {
    // Invalid provider metadata must not prevent a snapshot from being persisted.
  }
  return null
}

function mergeVisualizationOwner(metadataJson: string, ownerSessionId: string) {
  try {
    const value: unknown = JSON.parse(metadataJson)
    const metadata = typeof value === 'object' && value !== null ? value : {}
    return JSON.stringify({ ...metadata, visualizationSessionId: ownerSessionId })
  } catch {
    return JSON.stringify({ visualizationSessionId: ownerSessionId })
  }
}

/** The snapshot's assistant nodes that reference an inline visualization. */
export function inlineVisualizationNodeIds(nodes: readonly ProjectedSessionNodeInput[]) {
  return new Set(
    nodes
      .filter(
        (node) =>
          node.kind === 'assistant_message' &&
          containsInlineVisualizationReference(node.contentJson),
      )
      .map((node) => node.id),
  )
}

export function preserveVisualizationOwnership(
  nodes: readonly ProjectedSessionNodeInput[],
  existingMetadataByNodeId: ReadonlyMap<string, string>,
  candidateNodeIds: ReadonlySet<string> = inlineVisualizationNodeIds(nodes),
) {
  return nodes.map((node) => {
    if (!candidateNodeIds.has(node.id)) return node
    const owner = readVisualizationOwner(existingMetadataByNodeId.get(node.id) ?? '')
    if (!owner || readVisualizationOwner(node.metadataJson)) return node
    return { ...node, metadataJson: mergeVisualizationOwner(node.metadataJson, owner) }
  })
}
