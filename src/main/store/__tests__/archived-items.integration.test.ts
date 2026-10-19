import { SESSION_NOT_ARCHIVED_MESSAGE } from '@shared/types/archived-items'
import { SessionBranchId } from '@shared/types/brand'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareSessionDeletion, unarchiveSession } from '../session-details'
import {
  archiveSessionBranch,
  listArchivedItemRefs,
  queryArchivedItems,
  readArchivedItemStates,
  setArchiveTimes,
} from '../sessions'
import {
  archiveSeededSession,
  closeArchivedItemsStore,
  openArchivedItemsStore,
  readSessionArchiveColumns,
  seedSession,
  seedSessionWithBranch,
  setBranchArchivedAt,
} from './archived-items.test-support'

const state = vi.hoisted(() => ({ userDataDir: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => state.userDataDir },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

const HOUR = 3_600_000
const DAY = 24 * HOUR
const NOW = 1_800_000_000_000

/** Loading the app runtime cold can take most of a minute on a loaded runner: do it once, apart. */
const COLD_IMPORT_TIMEOUT_MS = 180_000
beforeAll(async () => {
  await import('../../runtime')
}, COLD_IMPORT_TIMEOUT_MS)
beforeEach(() => openArchivedItemsStore(state))
afterEach(() => closeArchivedItemsStore(state))

async function seedArchive() {
  const settings = await seedSession({
    key: 'settings',
    title: 'Migrate settings to Effect Schema',
    projectPath: '/work/openwaggle',
    transcript: ['Move the settings store', 'The legacy JSON reader bypasses the schema decode'],
  })
  const oauth = await seedSession({
    key: 'oauth',
    title: 'Fix MCP OAuth refresh flake',
    projectPath: '/work/openwaggle',
    transcript: ['Why does refresh fail?', 'The token refresh retries without backoff ENOENT'],
  })
  const guards = await seedSession({
    key: 'guards',
    title: 'Exhaustive guards for Result',
    projectPath: '/work/ts-match',
    transcript: ['Narrow both branches', 'P.exhaustive now narrows Result without a cast'],
  })
  const branchSession = await seedSessionWithBranch({
    key: 'branchy',
    title: 'Archive search prototypes',
    projectPath: '/work/openwaggle',
  })
  const branchId = SessionBranchId(`${branchSession}:branch:branch-user`)
  await archiveSessionBranch(branchSession, branchId)
  await archiveSeededSession(settings, NOW - 2 * HOUR)
  await archiveSeededSession(oauth, NOW - 3 * DAY)
  await archiveSeededSession(guards, NOW - 40 * DAY)
  await setBranchArchivedAt(String(branchId), NOW - HOUR)
  return { settings, oauth, guards, branchSession, branchId }
}

describe('Archive time', () => {
  it('is recorded when a session is archived and cleared when it is restored', async () => {
    const sessionId = await seedSession({
      key: 'one',
      title: 'One',
      projectPath: '/work/a',
      transcript: [],
    })
    const before = Date.now()
    await archiveSeededSession(sessionId, NOW)
    await unarchiveSession(sessionId)
    expect(await readSessionArchiveColumns(sessionId)).toEqual({ archived: 0, archived_at: null })

    const { archiveSession } = await import('../session-details')
    await archiveSession(sessionId)
    const columns = await readSessionArchiveColumns(sessionId)
    expect(columns?.archived).toBe(1)
    expect(columns?.archived_at).toBeGreaterThanOrEqual(before)
  })
})

describe('queryArchivedItems', () => {
  it('lists archived sessions and the archived branches of active sessions, newest first', async () => {
    const seeded = await seedArchive()
    const page = await queryArchivedItems({ limit: 10 }, NOW)

    expect(page.items.map((item) => item.title)).toEqual([
      'Start migration plan',
      'Migrate settings to Effect Schema',
      'Fix MCP OAuth refresh flake',
      'Exhaustive guards for Result',
    ])
    expect(page.items[0]).toMatchObject({
      ref: { kind: 'branch', sessionId: seeded.branchSession, branchId: seeded.branchId },
      parentTitle: 'Archive search prototypes',
      archivedAt: NOW - HOUR,
    })
    expect(page.total).toBe(4)
    expect(page.facets).toEqual({
      projects: [
        { projectPath: '/work/openwaggle', count: 3 },
        { projectPath: '/work/ts-match', count: 1 },
      ],
      archivedWithin: { any: 4, day: 2, week: 3, month: 3, older: 1 },
      kinds: { all: 4, session: 3, branch: 1 },
    })
  })

  it('matches every word in the title, project, parent title, or transcript', async () => {
    await seedArchive()
    const byTitle = await queryArchivedItems({ text: 'oauth flake', limit: 10 }, NOW)
    expect(byTitle.items.map((item) => item.title)).toEqual(['Fix MCP OAuth refresh flake'])
    expect(byTitle.items[0]?.snippet).toBeNull()

    const byParent = await queryArchivedItems({ text: 'prototypes', limit: 10 }, NOW)
    expect(byParent.items.map((item) => item.title)).toEqual(['Start migration plan'])

    const byProject = await queryArchivedItems({ text: 'ts-match', limit: 10 }, NOW)
    expect(byProject.items.map((item) => item.title)).toEqual(['Exhaustive guards for Result'])

    const none = await queryArchivedItems({ text: 'oauth guards', limit: 10 }, NOW)
    expect(none.items).toEqual([])
    expect(none.total).toBe(0)
  })

  it('finds words only the transcript holds, by prefix, with a highlighted excerpt', async () => {
    await seedArchive()
    const page = await queryArchivedItems({ text: 'legacy bypass', limit: 10 }, NOW)

    expect(page.items.map((item) => item.title)).toEqual(['Migrate settings to Effect Schema'])
    const snippet = page.items[0]?.snippet
    expect(snippet?.text).toContain('legacy JSON reader bypasses')
    const highlighted = snippet?.highlights.map(([start, end]) => snippet.text.slice(start, end))
    expect(highlighted).toEqual(['legacy', 'bypasses'])
  })

  it('ranks title matches above transcript matches', async () => {
    await seedArchive()
    const page = await queryArchivedItems({ text: 'refresh', limit: 10 }, NOW)
    expect(page.items.map((item) => item.title)).toEqual(['Fix MCP OAuth refresh flake'])

    const schema = await queryArchivedItems({ text: 'schema', limit: 10 }, NOW)
    expect(schema.items.map((item) => item.title)).toEqual(['Migrate settings to Effect Schema'])
  })

  it('counts each facet without its own selection', async () => {
    await seedArchive()
    const page = await queryArchivedItems(
      { project: { projectPath: '/work/openwaggle' }, archivedWithin: 'day', limit: 10 },
      NOW,
    )

    expect(page.items.map((item) => item.title)).toEqual([
      'Start migration plan',
      'Migrate settings to Effect Schema',
    ])
    expect(page.facets.projects).toEqual([{ projectPath: '/work/openwaggle', count: 2 }])
    expect(page.facets.archivedWithin).toEqual({ any: 3, day: 2, week: 3, month: 3, older: 0 })
    expect(page.facets.kinds).toEqual({ all: 2, session: 1, branch: 1 })
  })

  it('filters by type and by archives older than a month', async () => {
    await seedArchive()
    const branches = await queryArchivedItems({ kind: 'branch', limit: 10 }, NOW)
    expect(branches.items.map((item) => item.ref.kind)).toEqual(['branch'])

    const older = await queryArchivedItems({ archivedWithin: 'older', limit: 10 }, NOW)
    expect(older.items.map((item) => item.title)).toEqual(['Exhaustive guards for Result'])
  })

  it('pages with an opaque cursor and sorts oldest first on request', async () => {
    await seedArchive()
    const first = await queryArchivedItems({ sort: 'oldest', limit: 3 }, NOW)
    expect(first.items.map((item) => item.title)).toEqual([
      'Exhaustive guards for Result',
      'Fix MCP OAuth refresh flake',
      'Migrate settings to Effect Schema',
    ])
    expect(first.nextCursor).toBe('3')

    const second = await queryArchivedItems(
      { sort: 'oldest', limit: 3, ...(first.nextCursor ? { cursor: first.nextCursor } : {}) },
      NOW,
    )
    expect(second.items.map((item) => item.title)).toEqual(['Start migration plan'])
    expect(second.nextCursor).toBeUndefined()
  })

  it('treats LIKE wildcards in the search as literal text', async () => {
    await seedArchive()
    const page = await queryArchivedItems({ text: '%', limit: 10 }, NOW)
    expect(page.items).toEqual([])
  })
})

describe('listArchivedItemRefs', () => {
  it('returns every matching reference for Select all, with the total', async () => {
    const seeded = await seedArchive()
    const refs = await listArchivedItemRefs(
      { project: { projectPath: '/work/openwaggle' }, limit: 2 },
      NOW,
    )

    expect(refs.total).toBe(3)
    expect(refs.refs).toEqual([
      { kind: 'branch', sessionId: seeded.branchSession, branchId: seeded.branchId },
      { kind: 'session', sessionId: seeded.settings },
    ])
  })

  it('follows the list sort, so the first 1,000 are the ones shown first', async () => {
    const seeded = await seedArchive()
    const oldest = await listArchivedItemRefs({ sort: 'oldest', limit: 2 }, NOW)
    expect(oldest.refs).toEqual([
      { kind: 'session', sessionId: seeded.guards },
      { kind: 'session', sessionId: seeded.oauth },
    ])
  })
})

describe('non-ASCII search', () => {
  it('finds a title whatever the case of a non-ASCII letter typed', async () => {
    const sessionId = await seedSession({
      key: 'uber',
      title: 'Über Plan für Ärzte',
      projectPath: '/work/a',
      transcript: [],
    })
    await archiveSeededSession(sessionId, NOW - HOUR)
    for (const text of ['über', 'Über', 'ÜBER', 'ärzte']) {
      const page = await queryArchivedItems({ text, limit: 10 }, NOW)
      expect(
        page.items.map((item) => item.title),
        text,
      ).toEqual(['Über Plan für Ärzte'])
    }
  })
})

describe('archived item states', () => {
  it('reads Archive times, null for active items, and puts an Archive time back', async () => {
    const seeded = await seedArchive()
    const active = await seedSession({
      key: 'active',
      title: 'Active',
      projectPath: '/work/a',
      transcript: [],
    })
    const settingsRef = { kind: 'session', sessionId: seeded.settings } as const
    const branchRef = {
      kind: 'branch',
      sessionId: seeded.branchSession,
      branchId: seeded.branchId,
    } as const
    const states = await readArchivedItemStates([
      settingsRef,
      branchRef,
      { kind: 'session', sessionId: active },
    ])
    expect(states.get(`session:${String(seeded.settings)}`)).toBe(NOW - 2 * HOUR)
    expect(states.get(`branch:${String(seeded.branchSession)}:${String(seeded.branchId)}`)).toBe(
      NOW - HOUR,
    )
    expect(states.get(`session:${String(active)}`)).toBeNull()

    await setArchiveTimes([
      { ref: settingsRef, archivedAt: 42 },
      { ref: { kind: 'session', sessionId: active }, archivedAt: 42 },
    ])
    expect(await readSessionArchiveColumns(seeded.settings)).toEqual({
      archived: 1,
      archived_at: 42,
    })
    expect(await readSessionArchiveColumns(active)).toEqual({ archived: 0, archived_at: null })
  })
})

describe('deleting from Archived items', () => {
  it('refuses to journal the deletion of a session that is no longer archived', async () => {
    const sessionId = await seedSession({
      key: 'restored',
      title: 'Restored',
      projectPath: '/work/a',
      transcript: [],
    })
    await archiveSeededSession(sessionId, NOW)
    await unarchiveSession(sessionId)

    await expect(
      prepareSessionDeletion(sessionId, null, { requireArchived: true }),
    ).rejects.toThrow(SESSION_NOT_ARCHIVED_MESSAGE)
  })
})
