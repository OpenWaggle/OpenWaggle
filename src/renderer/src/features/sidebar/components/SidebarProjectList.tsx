import type { SessionSummary } from '@shared/types/session'
import { Folder } from 'lucide-react'
import type { SidebarProjectGroups } from '../lib/sidebar-project-groups'
import type { SidebarStateCount } from '../lib/sidebar-row-state'
import type {
  SidebarBranchActions,
  SidebarProjectActions,
  SidebarProjectRenderState,
  SidebarSessionActions,
} from '../model'
import { SidebarProjectGroupSection } from './SidebarProjectGroupSection'

interface SidebarProjectListProps {
  readonly sessionGroups: SidebarProjectGroups
  /** Roll-up per project, resolved once for the whole sidebar so counts cannot disagree. */
  readonly projectRollUp: (sessions: readonly SessionSummary[]) => readonly SidebarStateCount[]
  readonly renderState: SidebarProjectRenderState
  readonly displayProjectName: (path: string) => string
  readonly projectActions: SidebarProjectActions
  readonly sessionActions: SidebarSessionActions
  readonly branchActions: SidebarBranchActions
}

export function SidebarProjectList({
  sessionGroups,
  projectRollUp,
  renderState,
  displayProjectName,
  projectActions,
  sessionActions,
  branchActions,
}: SidebarProjectListProps) {
  if (sessionGroups.projects.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
        <Folder className="size-5 text-text-muted/75" />
        <p className="text-sm text-text-muted">No projects yet</p>
      </div>
    )
  }

  return sessionGroups.projects.map((group) => (
    <SidebarProjectGroupSection
      key={group.projectPath}
      group={group}
      rollUp={projectRollUp(group.sessions)}
      renderState={renderState}
      displayProjectName={displayProjectName}
      projectActions={projectActions}
      sessionActions={sessionActions}
      branchActions={branchActions}
    />
  ))
}
