import { getMessageText } from '@shared/types/agent'
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
      /** The first line of the message the draft starts from, when the sidebar has it. */
      readonly sourceLabel: string | null
    }
  | {
      readonly type: 'branch'
      readonly branch: SessionBranch
      readonly isActive: boolean
    }

interface BuildSidebarBranchRowsInput {
  readonly session: SessionSummary
  readonly activeSessionTree?: SessionTree | null
  readonly activeBranchId?: SessionBranchId | null | undefined
  readonly branchesCollapsed?: boolean
  readonly draftBranch: SidebarDraftBranchInput | null
}

function getSessionBranches(input: BuildSidebarBranchRowsInput) {
  if (input.activeSessionTree?.session.id === input.session.id) {
    return input.activeSessionTree.branches
  }
  return input.session.branches ?? []
}

/**
 * The first line of the draft's source message. A node id is no label: a discovered Pi
 * session's carries the Session id before the entry id (ADR 0050).
 */
function draftSourceLabel(input: BuildSidebarBranchRowsInput, sourceNodeId: SessionNodeId) {
  const tree = input.activeSessionTree
  if (tree?.session.id !== input.session.id) return null
  const message = tree.nodes.find((node) => node.id === sourceNodeId)?.message
  const firstLine = message
    ? getMessageText(message)
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.length > 0)
    : undefined
  return firstLine ?? null
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
    const { sourceNodeId } = input.draftBranch
    rows.push({ type: 'draft', sourceNodeId, sourceLabel: draftSourceLabel(input, sourceNodeId) })
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
