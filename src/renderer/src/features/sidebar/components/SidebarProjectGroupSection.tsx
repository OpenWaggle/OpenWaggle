import type { SessionSummary } from '@shared/types/session'
import { Edit3 } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { buildSidebarBranchRows } from '../lib/sidebar-branches'
import type { SidebarProjectGroup } from '../lib/sidebar-project-groups'
import type { SidebarStateCount } from '../lib/sidebar-row-state'
import type {
  SidebarBranchActions,
  SidebarProjectActions,
  SidebarProjectRenderState,
  SidebarSessionActions,
} from '../model'
import { SessionListItem } from './SessionListItem'
import { SidebarBranchRows } from './SidebarBranchRows'
import { SidebarProjectHeader } from './SidebarProjectHeader'

interface ProjectGroupSectionProps {
  readonly group: SidebarProjectGroup
  readonly rollUp: readonly SidebarStateCount[]
  readonly renderState: SidebarProjectRenderState
  readonly displayProjectName: (path: string) => string
  readonly projectActions: SidebarProjectActions
  readonly sessionActions: SidebarSessionActions
  readonly branchActions: SidebarBranchActions
}

/**
 * The unsaved session a project is about to start.
 *
 * Two lines like every other row, from the prototype: the title on line one, and line two
 * saying "Draft" where a state word goes with "unsaved" where a timestamp goes. It was a 34px
 * single line with a pill on the right, which made the one row that is not yet a session look
 * like a different kind of object.
 */
function DraftSessionRow({
  projectLabel,
  onSelect,
}: {
  readonly projectLabel: string
  readonly onSelect: () => void
}) {
  const rowStyle: React.CSSProperties & { '--row-color': string } = {
    '--row-color': 'var(--color-text-muted)',
  }

  return (
    <Button
      variant="unstyled"
      type="button"
      aria-current="true"
      aria-label={`Draft session in ${projectLabel}`}
      onClick={onSelect}
      data-qa="sidebar-draft-row"
      style={rowStyle}
      className="group flex min-h-[44px] w-full items-start gap-2 bg-bg-active py-1.5 pr-2 pl-6 text-left transition-colors hover:bg-bg-hover"
    >
      <span className="grid h-[17px] w-3.5 flex-none place-items-center text-[color:var(--row-color)]">
        <Edit3 className="size-3" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex h-[18.13px] min-w-0 items-center">
          <span className="block w-full truncate font-medium text-[12.5px] text-text-primary leading-[1.45]">
            New session
          </span>
        </span>
        <span className="flex h-4 min-w-0 items-center gap-1.5 text-[10.5px] text-text-muted leading-[1.45]">
          <span className="flex min-w-0 flex-auto items-center gap-[5px] overflow-hidden whitespace-nowrap">
            <span className="shrink-0 font-bold tracking-[0.02em] text-[color:var(--row-color)]">
              Draft
            </span>
          </span>
          <span className="flex flex-none items-center">unsaved</span>
        </span>
      </span>
    </Button>
  )
}

function sessionBranchDisclosure(session: SessionSummary, state: SidebarProjectRenderState) {
  const sourceBranches =
    state.activeSessionTree?.session.id === session.id
      ? state.activeSessionTree.branches
      : (session.branches ?? [])
  const visibleBranchCount = sourceBranches.filter((branch) => branch.archived !== true).length
  const hasDraftBranch = state.draftBranch?.sessionId === session.id
  const branchesCollapsed = session.treeUiState?.branchesSidebarCollapsed === true

  return {
    hasDisclosure: visibleBranchCount > 1 && !hasDraftBranch,
    rowsCollapsed: branchesCollapsed && !hasDraftBranch,
  }
}

function ProjectSessionRows({
  group,
  projectLabel,
  state,
  sessionActions,
  branchActions,
  onNewSession,
}: {
  readonly group: SidebarProjectGroup
  readonly projectLabel: string
  readonly state: SidebarProjectRenderState
  readonly sessionActions: SidebarSessionActions
  readonly branchActions: SidebarBranchActions
  readonly onNewSession: (path: string) => void
}) {
  const showDraftSession = state.draftSessionProjectPath === group.projectPath

  if (group.sessions.length === 0 && !showDraftSession) {
    // A project can empty out because every session it has is pinned. Saying so beats
    // "No sessions", which would read as data loss right after pinning the last one.
    const label =
      group.hoistedPinnedCount > 0
        ? `${group.hoistedPinnedCount} session${group.hoistedPinnedCount === 1 ? '' : 's'} pinned above`
        : 'No sessions'
    return <div className="px-10 py-1.5 text-[12px] text-text-muted">{label}</div>
  }

  return (
    <div className="space-y-0.5">
      {showDraftSession ? (
        <DraftSessionRow
          projectLabel={projectLabel}
          onSelect={() => onNewSession(group.projectPath)}
        />
      ) : null}
      {group.sessions.map((session) => (
        <ProjectSessionRow
          key={String(session.id)}
          session={session}
          state={state}
          sessionActions={sessionActions}
          branchActions={branchActions}
        />
      ))}
    </div>
  )
}

function ProjectSessionRow({
  session,
  state,
  sessionActions,
  branchActions,
}: {
  readonly session: SessionSummary
  readonly state: SidebarProjectRenderState
  readonly sessionActions: SidebarSessionActions
  readonly branchActions: SidebarBranchActions
}) {
  const disclosure = sessionBranchDisclosure(session, state)
  const branchRows = buildSidebarBranchRows({
    session,
    activeSessionTree: state.activeSessionTree,
    activeBranchId:
      session.id === state.activeSessionId ? state.activeBranchId : session.lastActiveBranchId,
    branchesCollapsed: disclosure.rowsCollapsed,
    draftBranch: state.draftBranch,
  })

  return (
    <div>
      <SessionListItem
        session={session}
        isActive={session.id === state.activeSessionId}
        variant="project"
        actions={sessionActions}
        branchDisclosure={{
          visible: disclosure.hasDisclosure,
          collapsed: disclosure.rowsCollapsed,
          onToggle: () => branchActions.toggle(session.id, !disclosure.rowsCollapsed),
        }}
      />
      <SidebarBranchRows sessionId={String(session.id)} rows={branchRows} actions={branchActions} />
    </div>
  )
}

export function SidebarProjectGroupSection({
  group,
  rollUp,
  renderState,
  displayProjectName,
  projectActions,
  sessionActions,
  branchActions,
}: ProjectGroupSectionProps) {
  const projectLabel = displayProjectName(group.projectPath)
  const collapsed = renderState.isProjectCollapsed(group.projectPath)

  return (
    <section className="mb-2">
      <SidebarProjectHeader
        group={group}
        projectLabel={projectLabel}
        isCurrentProject={group.projectPath === renderState.projectPath}
        collapsed={collapsed}
        rollUp={rollUp}
        actions={projectActions}
      />
      {collapsed ? null : (
        <ProjectSessionRows
          group={group}
          projectLabel={projectLabel}
          state={renderState}
          sessionActions={sessionActions}
          branchActions={branchActions}
          onNewSession={projectActions.newSession}
        />
      )}
    </section>
  )
}
