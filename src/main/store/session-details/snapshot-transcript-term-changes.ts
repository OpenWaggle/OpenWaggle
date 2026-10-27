import type { ProjectedSessionNodeInput } from '../../ports/session-repository'
import type { ComparedSessionNodeRow } from './types'

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

/*
 * A compared row without `content` has the snapshot node's digest, so its content and metadata are
 * unchanged (D6); one with `content` is compared value by value, as before digests existed.
 */
function contentChanged(existing: ComparedSessionNodeRow, next: { readonly contentJson: string }) {
  return existing.content !== null && existing.content.content_json !== next.contentJson
}

function metadataChanged(
  existing: ComparedSessionNodeRow,
  next: { readonly metadataJson: string },
) {
  return existing.content !== null && existing.content.metadata_json !== next.metadataJson
}

export function searchProjectionChanged(
  existing: ComparedSessionNodeRow,
  next: ProjectedNodeValues,
) {
  return (
    contentChanged(existing, next) ||
    existing.role !== next.role ||
    existing.kind !== next.kind ||
    existing.created_order !== next.createdOrder
  )
}

export function nodeProjectionChanged(existing: ComparedSessionNodeRow, next: ProjectedNodeValues) {
  return (
    searchProjectionChanged(existing, next) ||
    existing.parent_id !== next.parentId ||
    existing.pi_entry_type !== next.piEntryType ||
    existing.timestamp_ms !== next.timestampMs ||
    metadataChanged(existing, next) ||
    existing.branch_hint_id !== next.branchHintId ||
    existing.path_depth !== next.pathDepth
  )
}

function termProjectionChanged(existing: ComparedSessionNodeRow, next: ProjectedSessionNodeInput) {
  return (
    contentChanged(existing, next) ||
    existing.role !== next.role ||
    existing.kind !== next.kind ||
    existing.created_order !== next.createdOrder ||
    metadataChanged(existing, next)
  )
}

/** Returns nodes whose token contribution or deterministic first-evidence data can change. */
export function transcriptTermProjectionNodeIds(input: {
  readonly existingNodes: readonly ComparedSessionNodeRow[]
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
