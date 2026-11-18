import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProjectionRepository } from '../../../../ports/session-projection-repository'

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

const USAGE = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

function appendTurn(sessionManager: SessionManager, text: string) {
  sessionManager.appendMessage({ role: 'user', content: text, timestamp: 1 })
  sessionManager.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: `${text} answer` }],
    api: 'openai-responses',
    provider: 'provider',
    model: 'model',
    usage: USAGE,
    stopReason: 'stop',
    timestamp: 2,
  })
  return sessionManager.getSessionFile() ?? ''
}

let root = ''
let projectPath = ''

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-session-delete-transcripts-'))
  state.userDataDir = path.join(root, 'user-data')
  projectPath = path.join(root, 'project')
  await fs.mkdir(state.userDataDir)
  await fs.mkdir(projectPath)
  await promisify(execFile)('git', ['init', projectPath])
  vi.stubEnv('PI_CODING_AGENT_DIR', path.join(root, 'agent'))
  const { resetAppRuntimeForTests } = await import('../../../../runtime')
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  vi.useRealTimers()
  const { resetAppRuntimeForTests } = await import('../../../../runtime')
  await resetAppRuntimeForTests()
  vi.unstubAllEnvs()
  await fs.rm(root, { recursive: true, force: true })
})

/** A transcript file the Session's runs wrote under the same Pi session id at `createdAt`. */
function writeTranscript(cwd: string, piSessionId: string, createdAt: string) {
  vi.setSystemTime(new Date(createdAt))
  const sessionManager = SessionManager.create(cwd)
  sessionManager.newSession({ id: piSessionId })
  return appendTurn(sessionManager, createdAt)
}

/** Another Session's transcript, which deleting this Session must leave alone. */
function writeOtherTranscript(cwd: string) {
  return appendTurn(SessionManager.create(cwd), 'other')
}

async function exists(file: string) {
  return fs.stat(file).then(
    () => true,
    () => false,
  )
}

function runRepository(
  operation: (
    repository: typeof SessionProjectionRepository.Service,
  ) => Effect.Effect<void, unknown>,
) {
  return import('../../../../runtime').then(({ runAppEffect }) =>
    runAppEffect(
      Effect.gen(function* () {
        const repository = yield* SessionProjectionRepository
        yield* operation(repository)
      }),
    ),
  )
}

const deleteSession = (id: SessionId) => runRepository((repository) => repository.delete(id))

const recoverPendingDeletions = () =>
  runRepository((repository) => repository.recoverPendingDeletions?.() ?? Effect.void)

/**
 * A Session whose recorded file was never written: preparation recorded a manager it created in
 * the checkout, and the first run wrote its transcript under another name, with an older copy
 * abandoned in the recorded file's directory.
 */
async function sessionWithRediscoverableCopies() {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-04T18:41:20.000Z'))
  const prepared = SessionManager.create(projectPath)
  const piSessionId = prepared.getSessionId()
  const recorded = prepared.getSessionFile() ?? ''
  const abandoned = writeTranscript(projectPath, piSessionId, '2026-10-04T18:41:34.000Z')
  const firstRun = writeTranscript(projectPath, piSessionId, '2026-10-04T18:48:47.000Z')
  const other = writeOtherTranscript(projectPath)
  vi.useRealTimers()
  const { createSession } = await import('../../../../store/session-details')
  const session = await createSession({ projectPath, piSessionId, piSessionFile: recorded })
  return { session, recorded, copies: [abandoned, firstRun], other }
}

describe('Session deletion removes every Pi file of its transcript', () => {
  it('removes the copies the runtime would rediscover, and no other Pi session file', async () => {
    const { session, recorded, copies, other } = await sessionWithRediscoverableCopies()
    expect(await exists(recorded)).toBe(false)
    for (const copy of copies) expect(await exists(copy)).toBe(true)

    await deleteSession(session.id)

    for (const copy of copies) expect(await exists(copy)).toBe(false)
    expect(await exists(other)).toBe(true)
  })

  it('removes the transcript of a Session that never recorded a Pi file', async () => {
    const piSessionId = 'pi-session-without-recorded-file'
    const firstRun = writeTranscript(projectPath, piSessionId, '2026-10-04T18:41:34.000Z')
    const other = writeOtherTranscript(projectPath)
    const { createSession } = await import('../../../../store/session-details')
    const session = await createSession({ projectPath, piSessionId })

    await deleteSession(session.id)

    expect(await exists(firstRun)).toBe(false)
    expect(await exists(other)).toBe(true)
  })

  it('removes the copies when recovery resumes a deletion interrupted after the Session row was deleted', async () => {
    const { session, copies, other } = await sessionWithRediscoverableCopies()
    const store = await import('../../../../store/session-details')
    await store.prepareSessionDeletion(session.id)
    await store.commitSessionDeletion(session.id)
    await expect(store.getSessionDetail(session.id)).resolves.toBeNull()

    await recoverPendingDeletions()

    for (const copy of copies) expect(await exists(copy)).toBe(false)
    expect(await exists(other)).toBe(true)
    await expect(store.listPendingSessionDeletions()).resolves.not.toContain(session.id)
  })

  it('removes the copies when recovery resumes an interrupted Pi file cleanup', async () => {
    const { session, recorded, copies, other } = await sessionWithRediscoverableCopies()
    const store = await import('../../../../store/session-details')
    await store.prepareSessionDeletion(session.id)
    await store.commitSessionDeletion(session.id)
    await store.markSessionDeletionExternalCleanupComplete(session.id)
    await store.prepareSessionPiFileCleanup(session.id, recorded)

    await recoverPendingDeletions()

    for (const copy of copies) expect(await exists(copy)).toBe(false)
    expect(await exists(other)).toBe(true)
    await expect(store.listPendingSessionDeletions()).resolves.not.toContain(session.id)
  })
})
