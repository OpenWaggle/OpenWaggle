import type { SessionBranch } from '@shared/types/session'
import { SessionTreeBadge } from './SessionTreeBadge'

interface SessionTreeRowBadgesProps {
  readonly archivedBranch: SessionBranch | undefined
  readonly childPathCount: number
  readonly isActiveBranchHead: boolean
  readonly isDraftNode: boolean
  readonly nodeBranches: readonly SessionBranch[]
}

export function SessionTreeRowBadges({
  archivedBranch,
  childPathCount,
  isActiveBranchHead,
  isDraftNode,
  nodeBranches,
}: SessionTreeRowBadgesProps) {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1 pl-2">
      {childPathCount > 1 ? (
        <SessionTreeBadge label={`${childPathCount} paths`} tone="muted" />
      ) : null}
      {isDraftNode ? <SessionTreeBadge label="Draft" tone="warning" /> : null}
      {isActiveBranchHead ? <SessionTreeBadge label="Active" tone="accent" /> : null}
      {archivedBranch ? <SessionTreeBadge label="Archived" tone="muted" /> : null}
      {nodeBranches.map((branch) => (
        <SessionTreeBadge key={String(branch.id)} label={branch.name} tone="muted" />
      ))}
    </span>
  )
}
