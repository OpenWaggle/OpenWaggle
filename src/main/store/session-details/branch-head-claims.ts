import type { ProjectedSessionNodeInput } from '../../ports/session-repository'
import type { SessionBranchRow } from './types'

const FIRST_DUPLICATE_ID_SUFFIX = 2

/** Distance from a head to each node on its path, the head itself at 0. */
function depthsOnPath(nodeById: ReadonlyMap<string, ProjectedSessionNodeInput>, headId: string) {
  const depths = new Map<string, number>()
  let currentId: string | null = headId
  while (currentId && !depths.has(currentId)) {
    depths.set(currentId, depths.size)
    currentId = nodeById.get(currentId)?.parentId ?? null
  }
  return depths
}

/**
 * Assigns each head the saved branch it continues: the saved branch whose head is this head or
 * its nearest ancestor. Claims are made for every head before any fallback match, so a branch
 * started inside a saved branch cannot take that branch's row away from the head that grew it.
 * The nearest ancestor wins because a retry inside a branch saves a row at the retried node,
 * which is also an ancestor of the branch's own head.
 */
export function claimSavedBranchesByHead(
  heads: readonly string[],
  existingBranches: readonly SessionBranchRow[],
  context: {
    readonly mainHeadId: string | null
    readonly nodeById: ReadonlyMap<string, ProjectedSessionNodeInput>
  },
) {
  const claims = new Map<string, SessionBranchRow>()
  const claimedIds = new Set<string>()
  for (const headId of heads) {
    if (headId === context.mainHeadId) continue
    const depths = depthsOnPath(context.nodeById, headId)
    let nearest: { readonly row: SessionBranchRow; readonly depth: number } | null = null
    for (const row of existingBranches) {
      if (row.is_main === 1 || claimedIds.has(row.id) || !row.head_node_id) continue
      const depth = depths.get(row.head_node_id)
      if (depth !== undefined && (nearest === null || depth < nearest.depth)) {
        nearest = { row, depth }
      }
    }
    if (!nearest) continue
    claims.set(headId, nearest.row)
    claimedIds.add(nearest.row.id)
  }
  return { claims, claimedIds }
}

export function unusedBranchId(takenIds: ReadonlySet<string>, candidate: string) {
  let suffix = FIRST_DUPLICATE_ID_SUFFIX
  let id = candidate
  while (takenIds.has(id)) {
    id = `${candidate}:${String(suffix)}`
    suffix += 1
  }
  return id
}

/**
 * The first free `Branch N` from the head's position onwards. Numbering by position alone named
 * every newly selected branch `Branch 2`, because the active head always sits second.
 */
export function nextFallbackBranchName(takenNames: ReadonlySet<string>, start: number) {
  let number = start
  while (takenNames.has(`Branch ${String(number)}`)) number += 1
  return `Branch ${String(number)}`
}
