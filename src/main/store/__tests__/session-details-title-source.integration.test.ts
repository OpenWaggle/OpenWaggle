import lifecycleFs from 'node:fs/promises'
import lifecycleOs from 'node:os'
import lifecyclePath from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assignProvisionalSessionTitle, createSession, getSessionDetail } from '../session-details'

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
    lifecyclePath.join(lifecycleOs.tmpdir(), 'ow-session-title-source-'),
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

describe("a Session detail's title source", () => {
  it('says whether the Session still has its default title', async () => {
    const session = await createSession({
      projectPath: '/tmp/project-title',
      piSessionId: 'pi-session-title',
      piSessionFile: '/tmp/pi-session-title.jsonl',
    })

    expect((await getSessionDetail(session.id))?.titleSource).toBe('default')

    await assignProvisionalSessionTitle(session.id, 'Review the migration')

    expect((await getSessionDetail(session.id))?.titleSource).toBe('provisional')
  })
})
