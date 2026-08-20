import { SessionId } from '@shared/types/brand'
import type { PinnedSession, SessionSummary } from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import {
  buildPinnedSessionRows,
  DEFAULT_PINNED_SORT_MODE,
  resolvePinnedDropNeighbours,
} from '../pinned-sessions'
import { buildSidebarProjectGroups } from '../sidebar-project-groups'

function session(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: SessionId(id),
    title: id,
    projectPath: '/repo/one',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function pin(id: string, sortKey: string, pinnedAt = 1): PinnedSession {
  return { sessionId: SessionId(id), pinnedAt, sortKey }
}

const titles = (rows: readonly { readonly session: SessionSummary }[]) =>
  rows.map((row) => row.session.title)

describe('Pinned section rows', () => {
  it('defaults to Manual order', () => {
    expect(DEFAULT_PINNED_SORT_MODE).toBe('manual')
  })

  it('orders by Manual order using sort keys, not pin age', () => {
    const rows = buildPinnedSessionRows({
      pins: [pin('c', 'q', 30), pin('a', 'i', 10), pin('b', 'm', 20)],
      sessions: [session('a'), session('b'), session('c')],
      sortMode: 'manual',
    })

    expect(titles(rows)).toStrictEqual(['a', 'b', 'c'])
  })

  it('orders by Recent and Oldest from session activity', () => {
    const pins = [pin('a', 'i'), pin('b', 'm'), pin('c', 'q')]
    const sessions = [
      session('a', { updatedAt: 20 }),
      session('b', { updatedAt: 30 }),
      session('c', { updatedAt: 10 }),
    ]

    expect(titles(buildPinnedSessionRows({ pins, sessions, sortMode: 'recent' }))).toStrictEqual([
      'b',
      'a',
      'c',
    ])
    expect(titles(buildPinnedSessionRows({ pins, sessions, sortMode: 'oldest' }))).toStrictEqual([
      'c',
      'a',
      'b',
    ])
  })

  it('orders by Name', () => {
    const rows = buildPinnedSessionRows({
      pins: [pin('a', 'i'), pin('b', 'm')],
      sessions: [session('a', { title: 'Zebra' }), session('b', { title: 'Apple' })],
      sortMode: 'name',
    })

    expect(titles(rows)).toStrictEqual(['Apple', 'Zebra'])
  })

  it('returns to the same Manual order after a derived sort', () => {
    const pins = [pin('a', 'i'), pin('b', 'm'), pin('c', 'q')]
    const sessions = [
      session('a', { title: 'Zebra', updatedAt: 5 }),
      session('b', { title: 'Apple', updatedAt: 99 }),
      session('c', { title: 'Mango', updatedAt: 50 }),
    ]

    const manualBefore = titles(buildPinnedSessionRows({ pins, sessions, sortMode: 'manual' }))
    buildPinnedSessionRows({ pins, sessions, sortMode: 'name' })
    buildPinnedSessionRows({ pins, sessions, sortMode: 'recent' })
    const manualAfter = titles(buildPinnedSessionRows({ pins, sessions, sortMode: 'manual' }))

    expect(manualAfter).toStrictEqual(manualBefore)
    expect(manualAfter).toStrictEqual(['Zebra', 'Apple', 'Mango'])
  })

  it('renders no row for a pin whose session is archived or gone', () => {
    const rows = buildPinnedSessionRows({
      pins: [pin('a', 'i'), pin('missing', 'm'), pin('b', 'q')],
      sessions: [session('a'), session('b')],
      sortMode: 'manual',
    })

    expect(titles(rows)).toStrictEqual(['a', 'b'])
  })

  it('handles an empty pin list', () => {
    expect(
      buildPinnedSessionRows({ pins: [], sessions: [session('a')], sortMode: 'manual' }),
    ).toStrictEqual([])
  })
})

describe('Pinned drop neighbours', () => {
  const rows = buildPinnedSessionRows({
    pins: [pin('a', 'i'), pin('b', 'm'), pin('c', 'q')],
    sessions: [session('a'), session('b'), session('c')],
    sortMode: 'manual',
  })

  it('moving to the top has no after bound', () => {
    expect(resolvePinnedDropNeighbours(rows, 'c', 0)).toStrictEqual({
      afterSessionId: null,
      beforeSessionId: SessionId('a'),
    })
  })

  it('moving to the end has no before bound', () => {
    expect(resolvePinnedDropNeighbours(rows, 'a', 2)).toStrictEqual({
      afterSessionId: SessionId('c'),
      beforeSessionId: null,
    })
  })

  it('moving into the middle bounds both sides, excluding the dragged row', () => {
    expect(resolvePinnedDropNeighbours(rows, 'c', 1)).toStrictEqual({
      afterSessionId: SessionId('a'),
      beforeSessionId: SessionId('b'),
    })
  })

  it('clamps an out-of-range target instead of throwing', () => {
    expect(resolvePinnedDropNeighbours(rows, 'a', 99)).toStrictEqual({
      afterSessionId: SessionId('c'),
      beforeSessionId: null,
    })
    expect(resolvePinnedDropNeighbours(rows, 'a', -5)).toStrictEqual({
      afterSessionId: null,
      beforeSessionId: SessionId('b'),
    })
  })
})

describe('hoisting Pinned sessions out of project groups', () => {
  const sessions = [
    session('a', { projectPath: '/repo/one', createdAt: 10 }),
    session('b', { projectPath: '/repo/one', createdAt: 20 }),
    session('solo', { projectPath: '/repo/two', createdAt: 5 }),
  ]

  it('removes pinned sessions from their group and counts them', () => {
    const groups = buildSidebarProjectGroups({
      sessions,
      currentProjectPath: null,
      recentProjects: [],
      sortMode: 'recent',
      pinnedSessionIds: ['a'],
    })
    const one = groups.projects.find((group) => group.projectPath === '/repo/one')

    expect(one?.sessions.map((entry) => entry.title)).toStrictEqual(['b'])
    expect(one?.hoistedPinnedCount).toBe(1)
  })

  it('keeps a project whose every session is pinned, with a hoisted count', () => {
    const groups = buildSidebarProjectGroups({
      sessions,
      currentProjectPath: null,
      recentProjects: [],
      sortMode: 'recent',
      pinnedSessionIds: ['solo'],
    })
    const two = groups.projects.find((group) => group.projectPath === '/repo/two')

    expect(two).toBeDefined()
    expect(two?.sessions).toStrictEqual([])
    expect(two?.hoistedPinnedCount).toBe(1)
  })

  it('does not reorder projects when a session is pinned', () => {
    const order = (pinnedSessionIds: readonly string[]) =>
      buildSidebarProjectGroups({
        sessions,
        currentProjectPath: null,
        recentProjects: [],
        sortMode: 'recent',
        pinnedSessionIds,
      }).projects.map((group) => group.projectPath)

    expect(order(['a'])).toStrictEqual(order([]))
    expect(order(['solo'])).toStrictEqual(order([]))
  })

  it('reports no hoisting when nothing is pinned', () => {
    const groups = buildSidebarProjectGroups({
      sessions,
      currentProjectPath: null,
      recentProjects: [],
      sortMode: 'recent',
    })

    expect(groups.projects.every((group) => group.hoistedPinnedCount === 0)).toBe(true)
  })
})

/**
 * A Pinned shortcut is positional over the whole section, and the badge advertises it, so both
 * must come from the same numbering. Indexing the rendered rows meant that with a filter active
 * the row wearing the second badge was not the row the second shortcut opened.
 */
describe('Pinned shortcut positions', () => {
  it('numbers rows by their place in the section', () => {
    const rows = buildPinnedSessionRows({
      pins: [pin('a', 'a'), pin('b', 'b'), pin('c', 'c')],
      sessions: [session('a'), session('b'), session('c')],
      sortMode: 'manual',
    })

    expect(rows.map((row) => row.position)).toEqual([0, 1, 2])
  })

  it('keeps a position stable when an earlier row is filtered out of the view', () => {
    const all = buildPinnedSessionRows({
      pins: [pin('a', 'a'), pin('b', 'b'), pin('c', 'c')],
      sessions: [session('a'), session('b'), session('c')],
      sortMode: 'manual',
    })

    // What the sidebar does when a state chip or a text query hides the first pin.
    const shown = all.filter((row) => String(row.session.id) !== 'a')

    expect(shown.map((row) => String(row.session.id))).toEqual(['b', 'c'])
    expect(shown.map((row) => row.position)).toEqual([1, 2])
  })

  it('renumbers after a sort change, because a shortcut follows the section order', () => {
    const pins = [pin('a', 'a'), pin('b', 'b')]
    const sessions = [session('a', { updatedAt: 10 }), session('b', { updatedAt: 20 })]

    const manual = buildPinnedSessionRows({ pins, sessions, sortMode: 'manual' })
    const recent = buildPinnedSessionRows({ pins, sessions, sortMode: 'recent' })

    expect(manual.map((row) => [String(row.session.id), row.position])).toEqual([
      ['a', 0],
      ['b', 1],
    ])
    expect(recent.map((row) => [String(row.session.id), row.position])).toEqual([
      ['b', 0],
      ['a', 1],
    ])
  })
})
