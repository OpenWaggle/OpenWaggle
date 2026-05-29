import { SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'
import type { SessionBranch, SessionSummary, SessionTree } from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import { buildSidebarBranchRows } from '../sidebar-branches'
import { buildSidebarProjectGroups } from '../sidebar-project-groups'
import { groupSessionsByProject } from '../sidebar-utils'

function session(input: {
  readonly id: string
  readonly title: string
  readonly projectPath: string | null
  readonly createdAt: number
  readonly updatedAt: number
  readonly branches?: readonly SessionBranch[]
  readonly branchesSidebarCollapsed?: boolean
}): SessionSummary {
  return {
    id: SessionId(input.id),
    title: input.title,
    projectPath: input.projectPath,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    ...(input.branches ? { branches: input.branches } : {}),
    treeUiState:
      input.branchesSidebarCollapsed === undefined
        ? null
        : {
            sessionId: SessionId(input.id),
            expandedNodeIds: [],
            expandedNodeIdsTouched: false,
            branchesSidebarCollapsed: input.branchesSidebarCollapsed,
            updatedAt: input.updatedAt,
          },
  }
}

function branch(input: { readonly id: string; readonly archived?: boolean }): SessionBranch {
  return {
    id: SessionBranchId(input.id),
    sessionId: SessionId('session-a'),
    sourceNodeId: null,
    headNodeId: SessionNodeId(`node-${input.id}`),
    name: input.id,
    isMain: input.id === 'main',
    archived: input.archived ?? false,
    createdAt: 1,
    updatedAt: 1,
  }
}

function projectAt<TProject>(projects: readonly TProject[], index: number): TProject {
  const project = projects[index]
  if (!project) {
    throw new Error(`Expected project at index ${String(index)}`)
  }
  return project
}

describe('sidebar library helpers', () => {
  it('groups sessions by project path and names projectless sessions explicitly', () => {
    const grouped = groupSessionsByProject([
      session({ id: 's1', title: 'One', projectPath: '/work/app', createdAt: 1, updatedAt: 2 }),
      session({ id: 's2', title: 'Two', projectPath: null, createdAt: 3, updatedAt: 4 }),
    ])

    expect(grouped.map((group) => group.displayName)).toEqual(['app', 'No project'])
    expect(projectAt(grouped, 0).sessions.map((item) => item.title)).toEqual(['One'])
  })

  it('orders project groups by session recency and includes sessionless current or recent projects', () => {
    const result = buildSidebarProjectGroups({
      sessions: [
        session({ id: 'old', title: 'Old', projectPath: '/work/old', createdAt: 1, updatedAt: 10 }),
        session({ id: 'new', title: 'New', projectPath: '/work/new', createdAt: 5, updatedAt: 20 }),
      ],
      currentProjectPath: '/work/current',
      recentProjects: ['/work/recent', '/work/current'],
      sortMode: 'recent',
    })

    expect(result.projects.map((project) => project.projectPath)).toEqual([
      '/work/new',
      '/work/old',
      '/work/recent',
      '/work/current',
    ])
    expect(projectAt(result.projects, 0).sessions.map((item) => item.title)).toEqual(['New'])
  })

  it('sorts sessions within a project using the selected mode', () => {
    const result = buildSidebarProjectGroups({
      sessions: [
        session({ id: 'b', title: 'Beta', projectPath: '/work/app', createdAt: 1, updatedAt: 20 }),
        session({ id: 'a', title: 'Alpha', projectPath: '/work/app', createdAt: 2, updatedAt: 10 }),
      ],
      currentProjectPath: null,
      recentProjects: [],
      sortMode: 'name',
    })

    expect(projectAt(result.projects, 0).sessions.map((item) => item.title)).toEqual([
      'Alpha',
      'Beta',
    ])
  })

  it('builds branch rows from active session tree, hiding archived branches and respecting collapse state', () => {
    const main = branch({ id: 'main' })
    const feature = branch({ id: 'feature' })
    const archived = branch({ id: 'archived', archived: true })
    const currentSession = session({
      id: 'session-a',
      title: 'Session',
      projectPath: '/work/app',
      createdAt: 1,
      updatedAt: 2,
      branches: [main],
    })
    const tree = {
      session: currentSession,
      nodes: [],
      branches: [main, feature, archived],
      branchStates: [],
      uiState: null,
    } satisfies SessionTree

    expect(
      buildSidebarBranchRows({
        session: currentSession,
        activeSessionTree: tree,
        activeBranchId: SessionBranchId('feature'),
        branchesCollapsed: false,
        draftBranch: {
          sessionId: SessionId('session-a'),
          sourceNodeId: SessionNodeId('draft-source'),
        },
      }),
    ).toMatchObject([
      { type: 'draft', sourceNodeId: SessionNodeId('draft-source') },
      { type: 'branch', branch: main, isActive: false },
      { type: 'branch', branch: feature, isActive: true },
    ])

    expect(
      buildSidebarBranchRows({
        session: currentSession,
        activeSessionTree: tree,
        activeBranchId: SessionBranchId('feature'),
        branchesCollapsed: true,
        draftBranch: null,
      }),
    ).toEqual([])
  })
})
