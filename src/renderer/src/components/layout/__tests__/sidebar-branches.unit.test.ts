import { SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'
import type { SessionBranch, SessionSummary } from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import { buildSidebarBranchRows } from '../sidebar-branches'

function branch(input: {
  readonly sessionId: SessionId
  readonly id: string
  readonly name: string
  readonly isMain?: boolean
  readonly archived?: boolean
}): SessionBranch {
  return {
    id: SessionBranchId(input.id),
    sessionId: input.sessionId,
    sourceNodeId: null,
    headNodeId: SessionNodeId(`${input.id}:head`),
    name: input.name,
    isMain: input.isMain ?? false,
    archived: input.archived ? true : undefined,
    archivedAt: input.archived ? 10 : null,
    createdAt: 1,
    updatedAt: 2,
  }
}

function session(input: {
  readonly id: SessionId
  readonly branches: readonly SessionBranch[]
  readonly collapsed?: boolean
}): SessionSummary {
  return {
    id: input.id,
    title: String(input.id),
    projectPath: '/tmp/project',
    createdAt: 1,
    updatedAt: 2,
    branches: input.branches,
    treeUiState: {
      sessionId: input.id,
      expandedNodeIds: [],
      expandedNodeIdsTouched: false,
      branchesSidebarCollapsed: input.collapsed ?? false,
      updatedAt: 3,
    },
  }
}

describe('buildSidebarBranchRows', () => {
  it('shows materialized non-archived branches for every multi-branch session', () => {
    const sessionId = SessionId('session-1')
    const rows = buildSidebarBranchRows({
      session: session({
        id: sessionId,
        branches: [
          branch({ sessionId, id: 'session-1:main', name: 'main', isMain: true }),
          branch({ sessionId, id: 'session-1:branch:a', name: 'OAuth path' }),
          branch({ sessionId, id: 'session-1:branch:b', name: 'Archived path', archived: true }),
        ],
      }),
      draftBranch: null,
    })

    expect(rows.map((row) => row.type === 'branch' && row.branch.name)).toEqual([
      'main',
      'OAuth path',
    ])
  })

  it('hides materialized branch rows for collapsed sessions without drafts', () => {
    const sessionId = SessionId('session-1')
    const rows = buildSidebarBranchRows({
      session: session({
        id: sessionId,
        collapsed: true,
        branches: [
          branch({ sessionId, id: 'session-1:main', name: 'main', isMain: true }),
          branch({ sessionId, id: 'session-1:branch:a', name: 'OAuth path' }),
        ],
      }),
      draftBranch: null,
    })

    expect(rows).toEqual([])
  })

  it('can force branch rows visible while a draft auto-expands a collapsed session', () => {
    const sessionId = SessionId('session-1')
    const rows = buildSidebarBranchRows({
      session: session({
        id: sessionId,
        collapsed: true,
        branches: [
          branch({ sessionId, id: 'session-1:main', name: 'main', isMain: true }),
          branch({ sessionId, id: 'session-1:branch:a', name: 'OAuth path' }),
        ],
      }),
      branchesCollapsed: false,
      draftBranch: { sessionId, sourceNodeId: SessionNodeId('source-node') },
    })

    expect(rows.map((row) => (row.type === 'draft' ? 'draft' : row.branch.name))).toEqual([
      'draft',
      'main',
      'OAuth path',
    ])
  })
})
