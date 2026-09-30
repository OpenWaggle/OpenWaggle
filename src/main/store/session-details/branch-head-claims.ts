import type { ProjectedSessionNodeInput } from '../../ports/session-repository'
import { isDescendantOrSame } from './branch-utils'
import type { SessionBranchRow } from './types'

const FIRST_DUPLICATE_ID_SUFFIX = 2

/**
 * Assigns each head the saved branch it continues: the saved branch whose head is this head or
 * one of its ancestors. Claims are made for every head before any fallback match, so a branch
 * started inside a saved branch cannot take that branch's row away from the head that grew it.
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
    const row = existingBranches.find(
      (branch) =>
        branch.is_main !== 1 &&
        !claimedIds.has(branch.id) &&
        isDescendantOrSame(context.nodeById, headId, branch.head_node_id),
    )
    if (!row) continue
    claims.set(headId, row)
    claimedIds.add(row.id)
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
