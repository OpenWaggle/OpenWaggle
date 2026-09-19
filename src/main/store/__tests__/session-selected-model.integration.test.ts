import lifecycleFs from 'node:fs/promises'
import lifecycleOs from 'node:os'
import lifecyclePath from 'node:path'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSession, getSessionDetail, listSessionSummaries } from '../session-details'
import { setSessionSelectedModel } from '../session-details/session-mutations'

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
    lifecyclePath.join(lifecycleOs.tmpdir(), 'ow-session-selected-model-'),
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

/**
 * A model pick is a per-session fact, not an app-wide one. When it lived in the global settings
 * row, picking a model in one session silently retargeted every other session's next run. These
 * tests pin the session-scoped storage: one session's pick must never leak into another's.
 */
describe('per-session selected model', () => {
  it('round-trips a session pick through the live SQL path', async () => {
    const session = await createSession({
      projectPath: '/tmp/project-a',
      piSessionId: 'pi-model-a',
    })
    const model = SupportedModelId('anthropic/claude-opus-4-5')

    await setSessionSelectedModel(SessionId(String(session.id)), model)

    const detail = await getSessionDetail(SessionId(String(session.id)))
    expect(detail?.selectedModel).toBe(model)
  })

  it('never leaks a pick from one session into another', async () => {
    const sessionA = await createSession({
      projectPath: '/tmp/project-a',
      piSessionId: 'pi-model-a',
    })
    const sessionB = await createSession({
      projectPath: '/tmp/project-a',
      piSessionId: 'pi-model-b',
    })

    await setSessionSelectedModel(
      SessionId(String(sessionA.id)),
      SupportedModelId('anthropic/claude-opus-4-5'),
    )

    const detailB = await getSessionDetail(SessionId(String(sessionB.id)))
    expect(detailB?.selectedModel).toBeUndefined()

    const summaries = await listSessionSummaries()
    const summaryA = summaries.find((entry) => String(entry.id) === String(sessionA.id))
    const summaryB = summaries.find((entry) => String(entry.id) === String(sessionB.id))
    expect(summaryA?.selectedModel).toBe(SupportedModelId('anthropic/claude-opus-4-5'))
    expect(summaryB?.selectedModel).toBeUndefined()
  })

  it('leaves sessions without an explicit pick inheriting (no stored model)', async () => {
    const session = await createSession({
      projectPath: '/tmp/project-a',
      piSessionId: 'pi-model-a',
    })

    const detail = await getSessionDetail(SessionId(String(session.id)))
    expect(detail?.selectedModel).toBeUndefined()
  })
})
