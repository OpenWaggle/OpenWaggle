import type { SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'
import type { SessionBranch, SessionSummary, SessionTree } from '@shared/types/session'

interface SidebarDraftBranchInput {
  readonly sessionId: SessionId
  readonly sourceNodeId: SessionNodeId
}

export type SidebarBranchRow =
  | {
      readonly type: 'draft'
      readonly sourceNodeId: SessionNodeId
    }
  | {
      readonly type: 'branch'
      readonly branch: SessionBranch
      readonly isActive: boolean
    }

interface BuildSidebarBranchRowsInput {
  readonly session: SessionSummary
  readonly activeSessionTree?: SessionTree | null
  readonly activeBranchId?: SessionBranchId | null
  readonly branchesCollapsed?: boolean
  readonly draftBranch: SidebarDraftBranchInput | null
}

function getSessionBranches(input: BuildSidebarBranchRowsInput): readonly SessionBranch[] {
  if (input.activeSessionTree?.session.id === input.session.id) {
    return input.activeSessionTree.branches
  }
  return input.session.branches ?? []
}

function isDraftForSession(
  session: SessionSummary,
  draftBranch: SidebarDraftBranchInput | null,
): draftBranch is SidebarDraftBranchInput {
  return draftBranch !== null && draftBranch.sessionId === session.id
}

export function buildSidebarBranchRows(
  input: BuildSidebarBranchRowsInput,
): readonly SidebarBranchRow[] {
  const hasDraftBranch = isDraftForSession(input.session, input.draftBranch)
  const visibleBranches = getSessionBranches(input).filter((branch) => branch.archived !== true)
  const hasMaterializedBranchRows = visibleBranches.length > 1
  const collapsed =
    input.branchesCollapsed ?? input.session.treeUiState?.branchesSidebarCollapsed === true

  if (!hasDraftBranch && (!hasMaterializedBranchRows || collapsed)) {
    return []
  }

  const rows: SidebarBranchRow[] = []
  if (hasDraftBranch) {
    rows.push({ type: 'draft', sourceNodeId: input.draftBranch.sourceNodeId })
  }

  for (const branch of visibleBranches) {
    rows.push({
      type: 'branch',
      branch,
      isActive: branch.id === input.activeBranchId,
    })
  }

  return rows
}
