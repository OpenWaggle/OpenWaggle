import { SessionBranchId } from '@shared/types/brand'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { archiveSessionBranch, queryArchivedItems } from '../sessions'
import {
  archiveSeededSession,
  closeArchivedItemsStore,
  openArchivedItemsStore,
  seedSession,
  seedSessionWithBranch,
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
const NOW = 1_800_000_000_000
/** Loading the app runtime cold can take most of a minute on a loaded runner: do it once, apart. */
const COLD_IMPORT_TIMEOUT_MS = 180_000
beforeAll(async () => {
  await import('../../runtime')
}, COLD_IMPORT_TIMEOUT_MS)
beforeEach(() => openArchivedItemsStore(state))
afterEach(() => closeArchivedItemsStore(state))

async function titlesFor(text: string) {
  const page = await queryArchivedItems({ text, limit: 10 }, NOW)
  return page.items.map((item) => item.title)
}

describe('non-ASCII search', () => {
  it('folds Unicode case in titles, whatever the case typed or stored', async () => {
    const sessionId = await seedSession({
      key: 'uber',
      title: 'ÜBER Plan für Ärzte in İzmir',
      projectPath: '/work/a',
      transcript: [],
    })
    await archiveSeededSession(sessionId, NOW - HOUR)
    for (const text of [
      'über',
      'Über',
      'ÜBER',
      'üBeR',
      'ärzte',
      'FÜR',
      'plan ÄRZTE',
      'izmir',
      'İZMİR',
    ]) {
      expect(await titlesFor(text), text).toEqual(['ÜBER Plan für Ärzte in İzmir'])
    }
  })

  it('folds Unicode case in project paths and parent session titles', async () => {
    const sessionId = await seedSession({
      key: 'path',
      title: 'Plain title',
      projectPath: '/work/Straße/Ωmega/GrünÖl',
      transcript: [],
    })
    await archiveSeededSession(sessionId, NOW - HOUR)
    const parent = await seedSessionWithBranch({
      key: 'parent',
      title: 'Éclair Rollout',
      projectPath: '/work/b',
    })
    const branchId = SessionBranchId(`${parent}:branch:branch-user`)
    await archiveSessionBranch(parent, branchId)

    expect(await titlesFor('ωMEGA')).toEqual(['Plain title'])
    expect(await titlesFor('STRAßE')).toEqual(['Plain title'])
    expect(await titlesFor('grünöl')).toEqual(['Plain title'])
    const branch = await queryArchivedItems({ text: 'éclair', limit: 10 }, NOW)
    expect(branch.items.map((item) => item.parentTitle)).toEqual(['Éclair Rollout'])
  })

  it('matches composed and decomposed accents alike, and ranks a title start first', async () => {
    const decomposed = await seedSession({
      key: 'decomposed',
      title: 'Cafe\u0301 menu',
      projectPath: '/work/c',
      transcript: [],
    })
    const later = await seedSession({
      key: 'later',
      title: 'Our CAFÉ',
      projectPath: '/work/c',
      transcript: [],
    })
    await archiveSeededSession(decomposed, NOW - 2 * HOUR)
    await archiveSeededSession(later, NOW - HOUR)

    expect(await titlesFor('café')).toEqual(['Cafe\u0301 menu', 'Our CAFÉ'])
  })
})
