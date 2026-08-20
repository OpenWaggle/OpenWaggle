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
  createdAt = CREATED_AT,
): SessionSummary {
  return {
    id: SessionId(id),
    title,
    projectPath,
    createdAt,
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
      '/repo/other',
      '/repo/empty',
    ])
    expect(grouped.projects[0]?.sessions.map((session) => session.title)).toEqual([
      'Current new',
      'Current old',
    ])
    expect(grouped.projects[2]?.latestUpdatedAt).toBe(EMPTY_LATEST_UPDATED_AT)
    expect(grouped.projects[2]?.sessions).toEqual([])
  })

  it('orders projects by newest first-session timestamp without promoting the selected project', () => {
    const grouped = buildSidebarProjectGroups({
      currentProjectPath: '/repo/current',
      recentProjects: ['/repo/sessionless'],
      sortMode: 'recent',
      sessions: [
        makeSession('current', 'Current project', '/repo/current', UPDATED_AT_NEW, 30),
        makeSession('newer', 'Newer project', '/repo/newer', UPDATED_AT_MIDDLE, 40),
        makeSession('older', 'Older project', '/repo/older', UPDATED_AT_OLD, 20),
      ],
    })

    expect(grouped.projects.map((project) => project.projectPath)).toEqual([
      '/repo/newer',
      '/repo/current',
      '/repo/older',
      '/repo/sessionless',
    ])
  })

  it('keeps session-only projects visible when they are not recent projects', () => {
    const grouped = buildSidebarProjectGroups({
      currentProjectPath: null,
      recentProjects: [],
      sortMode: 'recent',
      sessions: [
        makeSession('one', 'Older project', '/repo/old', UPDATED_AT_OLD, 20),
        makeSession('two', 'Newer project', '/repo/new', UPDATED_AT_NEW, 40),
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

describe('a project group carries every session it owns', () => {
  /*
   * `sessions` is what the tree renders: narrowed by the filter and with pinned rows hoisted out.
   * A project-wide action must not act on that subset. Archiving from the project menu offered the
   * visible count and archived only those, and a project whose sessions were all pinned reported
   * nothing to archive at all.
   */
  it('keeps the sessions a filter hid out of the rendered rows', () => {
    const visible = [makeSession('a', 'Session a', '/repo', 3)]
    const everything = [
      makeSession('a', 'Session a', '/repo', 3),
      makeSession('b', 'Session b', '/repo', 2),
      makeSession('c', 'Session c', '/repo', 1),
    ]

    const groups = buildSidebarProjectGroups({
      sessions: visible,
      currentProjectPath: '/repo',
      recentProjects: [],
      sortMode: 'recent',
      allSessions: everything,
    })

    const group = groups.projects.find((candidate) => candidate.projectPath === '/repo')
    expect(group?.sessions).toHaveLength(1)
    expect(group?.allSessions).toHaveLength(3)
  })

  it('keeps the pinned sessions hoisted out of the rendered rows', () => {
    const everything = [
      makeSession('a', 'Session a', '/repo', 2),
      makeSession('b', 'Session b', '/repo', 1),
    ]

    const groups = buildSidebarProjectGroups({
      sessions: everything,
      currentProjectPath: '/repo',
      recentProjects: [],
      sortMode: 'recent',
      pinnedSessionIds: ['a', 'b'],
      allSessions: everything,
    })

    const group = groups.projects.find((candidate) => candidate.projectPath === '/repo')
    // Every row is pinned away, so the group renders nothing but still owns both sessions.
    expect(group?.sessions).toHaveLength(0)
    expect(group?.allSessions).toHaveLength(2)
  })

  it('falls back to the rendered sessions when no unfiltered list is given', () => {
    const rendered = [makeSession('a', 'Session a', '/repo', 1)]

    const groups = buildSidebarProjectGroups({
      sessions: rendered,
      currentProjectPath: '/repo',
      recentProjects: [],
      sortMode: 'recent',
    })

    expect(groups.projects[0]?.allSessions).toHaveLength(1)
  })
})
