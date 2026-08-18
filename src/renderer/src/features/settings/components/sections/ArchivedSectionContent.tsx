import type { SessionBranchId, SessionId } from '@shared/types/brand'
import type { ProjectGroup } from '@/features/sidebar/lib'
import { ArchivedBranchGroup } from './ArchivedBranchGroup'
import { ArchivedErrorAlert } from './ArchivedErrorAlert'
import { ArchivedSessionGroup } from './ArchivedSessionGroup'
import type { ArchivedBranchProjectGroup } from './archived-branch-groups'

interface ArchivedSectionContentProps {
  readonly groups: readonly ProjectGroup[]
  readonly branchGroups: readonly ArchivedBranchProjectGroup[]
  readonly actionError: string | null
  readonly queryError: string | null
  readonly onRestore: (id: SessionId) => void
  readonly onDelete: (id: SessionId) => void
  readonly onRestoreBranch: (sessionId: SessionId, branchId: SessionBranchId) => void
}

export function ArchivedSectionContent({
  groups,
  branchGroups,
  actionError,
  queryError,
  onRestore,
  onDelete,
  onRestoreBranch,
}: ArchivedSectionContentProps) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[15px] font-medium text-text-primary">
          Archived sessions and branches
        </h2>
        <p className="mt-1 text-[13px] text-text-tertiary">
          Sessions and branches removed from normal navigation. Restore them to bring them back.
        </p>
      </div>
      {actionError && <ArchivedErrorAlert message={actionError} />}
      {queryError && <ArchivedErrorAlert message={queryError} subtle />}
      {groups.length > 0 ? (
        <div className="space-y-2">
          <h3 className="px-2 text-[12px] font-medium text-text-tertiary">Archived sessions</h3>
          {groups.map((group) => (
            <ArchivedSessionGroup
              key={group.path ?? '__none__'}
              group={group}
              onRestore={onRestore}
              onDelete={onDelete}
            />
          ))}
        </div>
      ) : null}
      {branchGroups.length > 0 ? (
        <div className="space-y-2">
          <h3 className="px-2 text-[12px] font-medium text-text-tertiary">Archived branches</h3>
          {branchGroups.map((group) => (
            <ArchivedBranchGroup
              key={group.path ?? '__none__'}
              group={group}
              onRestoreBranch={onRestoreBranch}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
