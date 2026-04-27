import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import { buildSidebarProjectGroups } from '../sidebar-project-groups'

const CREATED_AT = 10
const UPDATED_AT_OLD = 20
const UPDATED_AT_MIDDLE = 30
const UPDATED_AT_NEW = 40
const EMPTY_LATEST_UPDATED_AT = 0

function makeSession(
  id: string,
  title: string,
  projectPath: string | null,
  updatedAt: number,
): SessionSummary {
  return {
    id: SessionId(id),
    title,
    projectPath,
    createdAt: CREATED_AT,
    updatedAt,
    lastActiveNodeId: null,
    lastActiveBranchId: null,
  }
}

describe('buildSidebarProjectGroups', () => {
  it('groups Pi session summaries under current and recent project sections', () => {
    const grouped = buildSidebarProjectGroups({
      currentProjectPath: '/repo/current',
      recentProjects: ['/repo/empty', '/repo/other'],
      sortMode: 'recent',
      sessions: [
        makeSession('one', 'Current new', '/repo/current', UPDATED_AT_NEW),
        makeSession('two', 'Current old', '/repo/current', UPDATED_AT_OLD),
        makeSession('three', 'Other', '/repo/other', UPDATED_AT_MIDDLE),
        makeSession('four', 'Ignored projectless session', null, UPDATED_AT_NEW),
      ],
    })

    expect(grouped.projects.map((project) => project.projectPath)).toEqual([
      '/repo/current',
      '/repo/empty',
      '/repo/other',
    ])
    expect(grouped.projects[0]?.sessions.map((session) => session.title)).toEqual([
      'Current new',
      'Current old',
    ])
    expect(grouped.projects[1]?.latestUpdatedAt).toBe(EMPTY_LATEST_UPDATED_AT)
    expect(grouped.projects[1]?.sessions).toEqual([])
  })

  it('keeps session-only projects visible when they are not recent projects', () => {
    const grouped = buildSidebarProjectGroups({
      currentProjectPath: null,
      recentProjects: [],
      sortMode: 'recent',
      sessions: [
        makeSession('one', 'Older project', '/repo/old', UPDATED_AT_OLD),
        makeSession('two', 'Newer project', '/repo/new', UPDATED_AT_NEW),
      ],
    })

    expect(grouped.projects.map((project) => project.projectPath)).toEqual([
      '/repo/new',
      '/repo/old',
    ])
  })

  it('sorts sessions within each project by the selected mode', () => {
    const grouped = buildSidebarProjectGroups({
      currentProjectPath: '/repo/current',
      recentProjects: [],
      sortMode: 'name',
      sessions: [
        makeSession('one', 'Zulu', '/repo/current', UPDATED_AT_NEW),
        makeSession('two', 'Alpha', '/repo/current', UPDATED_AT_OLD),
        makeSession('three', 'Beta', null, UPDATED_AT_MIDDLE),
        makeSession('four', 'Able', null, UPDATED_AT_NEW),
      ],
    })

    expect(grouped.projects[0]?.sessions.map((session) => session.title)).toEqual(['Alpha', 'Zulu'])
  })

  it('does not expose projectless sessions as a global Chats section', () => {
    const grouped = buildSidebarProjectGroups({
      currentProjectPath: null,
      recentProjects: [],
      sortMode: 'recent',
      sessions: [makeSession('one', 'Projectless', null, UPDATED_AT_NEW)],
    })

    expect(grouped.projects).toEqual([])
  })
})
