import type { ProjectedSessionNodeInput } from '../../ports/session-repository'
import type { SessionNodeRow } from './types'

interface ProjectedNodeValues {
  readonly parentId: string | null
  readonly piEntryType: string | null
  readonly kind: ProjectedSessionNodeInput['kind']
  readonly role: ProjectedSessionNodeInput['role']
  readonly timestampMs: number
  readonly contentJson: string
  readonly metadataJson: string
  readonly branchHintId: string | null
  readonly pathDepth: number
  readonly createdOrder: number
}

export function searchProjectionChanged(existing: SessionNodeRow, next: ProjectedNodeValues) {
  return (
    existing.content_json !== next.contentJson ||
    existing.role !== next.role ||
    existing.kind !== next.kind ||
    existing.created_order !== next.createdOrder
  )
}

export function nodeProjectionChanged(existing: SessionNodeRow, next: ProjectedNodeValues) {
  return (
    searchProjectionChanged(existing, next) ||
    existing.parent_id !== next.parentId ||
    existing.pi_entry_type !== next.piEntryType ||
    existing.timestamp_ms !== next.timestampMs ||
    existing.metadata_json !== next.metadataJson ||
    existing.branch_hint_id !== next.branchHintId ||
    existing.path_depth !== next.pathDepth
  )
}

function termProjectionChanged(existing: SessionNodeRow, next: ProjectedSessionNodeInput) {
  return (
    existing.content_json !== next.contentJson ||
    existing.role !== next.role ||
    existing.kind !== next.kind ||
    existing.created_order !== next.createdOrder ||
    existing.metadata_json !== next.metadataJson
  )
}

/** Returns nodes whose token contribution or deterministic first-evidence data can change. */
export function transcriptTermProjectionNodeIds(input: {
  readonly existingNodes: readonly SessionNodeRow[]
  readonly nodes: readonly ProjectedSessionNodeInput[]
}) {
  const existingById = new Map(input.existingNodes.map((node) => [node.id, node]))
  const retainedIds = new Set(input.nodes.map((node) => node.id))
  const changedIds = new Set<string>()
  for (const node of input.nodes) {
    const existing = existingById.get(node.id)
    if (!existing || termProjectionChanged(existing, node)) changedIds.add(node.id)
  }
  for (const existing of input.existingNodes) {
    if (!retainedIds.has(existing.id)) changedIds.add(existing.id)
  }
  return [...changedIds]
}
