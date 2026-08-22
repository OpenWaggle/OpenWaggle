import lifecycleFs from 'node:fs/promises'
import lifecycleOs from 'node:os'
import lifecyclePath from 'node:path'
import { SessionId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listPinnedSessions, movePinnedSession, pinSession, unpinSession } from '../pinned-sessions'
import { createSession } from '../session-details'
import {
  archiveSession,
  deleteSession,
  unarchiveSession,
} from '../session-details/session-mutations'

const { state, getPathMock } = vi.hoisted(() => ({
  state: { userDataDir: '' },
  getPathMock: vi.fn(() => ''),
}))

getPathMock.mockImplementation(() => state.userDataDir)

vi.mock('electron', () => ({
  app: { getPath: getPathMock },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

beforeEach(async () => {
  state.userDataDir = await lifecycleFs.mkdtemp(
    lifecyclePath.join(lifecycleOs.tmpdir(), 'ow-pinned-sessions-'),
  )
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  const tmpDir = state.userDataDir
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
  await lifecycleFs.rm(tmpDir, { recursive: true, force: true })
})

async function makeSession(piSessionId: string) {
  const session = await createSession({ projectPath: '/repo/openwaggle', piSessionId })
  return SessionId(String(session.id))
}

const pinnedIds = async () => (await listPinnedSessions()).map((pin) => String(pin.sessionId))

/**
 * Pins are one row per pin with a fractional sort key (ADR 0019). These tests drive the
 * real SQLite path, because the two properties that matter are enforced by the schema
 * rather than by application code: the primary key makes double-pinning impossible, and
 * the foreign key cascade removes a pin when its session is deleted.
 */
describe('pinned session persistence', () => {
  it('appends new pins to the end of Manual order', async () => {
    const first = await makeSession('pi-1')
    const second = await makeSession('pi-2')
    const third = await makeSession('pi-3')

    await pinSession(first)
    await pinSession(second)
    await pinSession(third)

    expect(await pinnedIds()).toStrictEqual([String(first), String(second), String(third)])
  })

  it('returns pins ordered by sort key, with ascending keys', async () => {
    const first = await makeSession('pi-1')
    const second = await makeSession('pi-2')
    await pinSession(first)
    await pinSession(second)

    const pins = await listPinnedSessions()
    const keys = pins.map((pin) => pin.sortKey)
    expect(keys).toStrictEqual([...keys].sort())
    expect(pins.every((pin) => pin.pinnedAt > 0)).toBe(true)
  })

  it('pinning twice does not duplicate or move the pin', async () => {
    const first = await makeSession('pi-1')
    const second = await makeSession('pi-2')
    await pinSession(first)
    await pinSession(second)
    const before = await listPinnedSessions()

    await pinSession(first)

    expect(await listPinnedSessions()).toStrictEqual(before)
  })

  it('unpins, and unpinning something unpinned is a no-op', async () => {
    const first = await makeSession('pi-1')
    const second = await makeSession('pi-2')
    await pinSession(first)
    await pinSession(second)

    await unpinSession(first)
    expect(await pinnedIds()).toStrictEqual([String(second)])

    await unpinSession(first)
    expect(await pinnedIds()).toStrictEqual([String(second)])
  })

  it('moves a pin to the top, writing only that pin', async () => {
    const first = await makeSession('pi-1')
    const second = await makeSession('pi-2')
    const third = await makeSession('pi-3')
    await pinSession(first)
    await pinSession(second)
    await pinSession(third)
    const untouched = (await listPinnedSessions()).filter(
      (pin) => String(pin.sessionId) !== String(third),
    )

    await movePinnedSession({
      sessionId: third,
      afterSessionId: null,
      beforeSessionId: first,
    })

    expect(await pinnedIds()).toStrictEqual([String(third), String(first), String(second)])
    const after = await listPinnedSessions()
    for (const pin of untouched) {
      const still = after.find((entry) => String(entry.sessionId) === String(pin.sessionId))
      expect(still?.sortKey).toBe(pin.sortKey)
    }
  })

  it('moves a pin between two neighbours', async () => {
    const first = await makeSession('pi-1')
    const second = await makeSession('pi-2')
    const third = await makeSession('pi-3')
    await pinSession(first)
    await pinSession(second)
    await pinSession(third)

    await movePinnedSession({
      sessionId: third,
      afterSessionId: first,
      beforeSessionId: second,
    })

    expect(await pinnedIds()).toStrictEqual([String(first), String(third), String(second)])
  })

  it('moves a pin to the end', async () => {
    const first = await makeSession('pi-1')
    const second = await makeSession('pi-2')
    await pinSession(first)
    await pinSession(second)

    await movePinnedSession({
      sessionId: first,
      afterSessionId: second,
      beforeSessionId: null,
    })

    expect(await pinnedIds()).toStrictEqual([String(second), String(first)])
  })

  it('ignores a move of a session that is not pinned', async () => {
    const first = await makeSession('pi-1')
    const unpinned = await makeSession('pi-2')
    await pinSession(first)

    await movePinnedSession({
      sessionId: unpinned,
      afterSessionId: null,
      beforeSessionId: first,
    })

    expect(await pinnedIds()).toStrictEqual([String(first)])
  })

  it('keeps the pin when the session is archived, and through unarchive', async () => {
    const first = await makeSession('pi-1')
    const second = await makeSession('pi-2')
    await pinSession(first)
    await pinSession(second)

    await archiveSession(first)
    expect(await pinnedIds()).toStrictEqual([String(first), String(second)])

    await unarchiveSession(first)
    expect(await pinnedIds()).toStrictEqual([String(first), String(second)])
  })

  it('removes the pin when the session is deleted, by foreign key cascade', async () => {
    const first = await makeSession('pi-1')
    const second = await makeSession('pi-2')
    await pinSession(first)
    await pinSession(second)

    await deleteSession(first)

    expect(await pinnedIds()).toStrictEqual([String(second)])
  })

  it('survives a store restart', async () => {
    const first = await makeSession('pi-1')
    const second = await makeSession('pi-2')
    await pinSession(first)
    await pinSession(second)
    await movePinnedSession({
      sessionId: second,
      afterSessionId: null,
      beforeSessionId: first,
    })
    const expected = await listPinnedSessions()

    const { resetAppRuntimeForTests } = await import('../../runtime')
    await resetAppRuntimeForTests()

    expect(await listPinnedSessions()).toStrictEqual(expected)
  })
})
