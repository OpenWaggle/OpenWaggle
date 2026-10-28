import type { ProjectedSessionNodeInput } from '../../ports/session-repository'

/**
 * Snapshot nodes a Pi projection kept from its previous projection (D6).
 *
 * When a Session's Pi file only grew since its last projection, a Run's projection computes the
 * Pi entries before that point lazily: their node content is what the previous projection stored
 * (same entry bytes, same ancestors, same context-omission state), so it is only computed if
 * something reads it. The projection marks each such node with the projection revision it was kept
 * from. Snapshot persistence trusts a marked node as unchanged, without hashing or comparing its
 * content, only when that revision is still the Session's current one in the same transaction.
 *
 * The mark belongs to the node object: any step that copies a node drops it, and the copy is then
 * compared like any other node. A missing mark only costs time, never correctness. That is why it is
 * not a list of node ids in the snapshot: steps between the projection and persistence copy nodes
 * and change them under the same id (inline-visualization ownership rewrites `metadataJson`, the
 * ADR 0049 entry-id repair rewrites `contentJson`), and an id list would make the store trust and
 * drop those changes unless every such step remembered to remove the id.
 */
const retainedFromRevision = new WeakMap<ProjectedSessionNodeInput, number>()

export function markRetainedSnapshotNode(node: ProjectedSessionNodeInput, revision: number) {
  retainedFromRevision.set(node, revision)
  return node
}

/** The ids of the snapshot nodes kept from `revision`, the Session's current projection. */
export function retainedSnapshotNodeIds(
  nodes: readonly ProjectedSessionNodeInput[],
  revision: number,
): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const node of nodes) {
    if (retainedFromRevision.get(node) === revision) ids.add(node.id)
  }
  return ids
}
