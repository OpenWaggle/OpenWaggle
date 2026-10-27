import { appendFileSync, mkdirSync } from 'node:fs'
import type * as FsPromises from 'node:fs/promises'
import fs, { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSession, persistSessionSnapshot } from '../../../store/session-details'
import { getPiSessionProjectionState } from '../../../store/session-details/pi-session-discovery-store'
import { projectPiSessionSnapshot } from '../agent-kernel/session-projection'
import { createPiSessionFiles } from '../pi-session-files'

/**
 * A refresh of a Session whose Pi file changed reads only the bytes appended after the
 * projection's recorded tail while the file only grew (D6): usage entries alone, which a warming
 * session appends after every Run, leave the projection as it is without parsing the whole file.
 */

const { state, getPathMock } = vi.hoisted(() => ({
  state: { userDataDir: '', root: '' },
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

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>()
  const readFile = vi.fn(actual.readFile)
  return { ...actual, default: { ...actual, readFile }, readFile }
})

function filesRead() {
  return vi.mocked(readFile).mock.calls.map(([file]) => file)
}

const CWD = '/tmp/tail-refresh'
const USAGE = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

beforeEach(async () => {
  state.root = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-tail-refresh-'))
  state.userDataDir = path.join(state.root, 'user-data')
  mkdirSync(state.userDataDir, { recursive: true })
  const { resetAppRuntimeForTests } = await import('../../../runtime')
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  const { resetAppRuntimeForTests } = await import('../../../runtime')
  await resetAppRuntimeForTests()
  await fs.rm(state.root, { recursive: true, force: true })
})

function answer(manager: SessionManager, text: string) {
  return manager.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-test',
    usage: USAGE,
    stopReason: 'stop',
    timestamp: 2,
  })
}

async function projectedSession() {
  const manager = SessionManager.create(CWD, path.join(state.root, 'sessions'))
  manager.appendMessage({ role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 1 })
  answer(manager, 'hi')
  const session = await createSession({ projectPath: CWD, piSessionId: manager.getSessionId() })
  const sessionId = SessionId(String(session.id))
  const snapshot = projectPiSessionSnapshot({ sessionManager: manager })
  await persistSessionSnapshot({
    sessionId,
    piSessionId: manager.getSessionId(),
    piSessionFile: manager.getSessionFile(),
    activeNodeId: snapshot.activeNodeId,
    nodes: snapshot.nodes,
  })
  return { manager, sessionId, file: manager.getSessionFile() ?? '' }
}

async function readSnapshot(sessionId: SessionId, file: string) {
  const projection = await getPiSessionProjectionState(sessionId)
  return Effect.runPromise(
    createPiSessionFiles().readSnapshot({
      piSessionFile: file,
      cwd: CWD,
      projectedPiEntryCount: projection?.projectedPiEntryCount ?? 0,
      projectedNodeIds: projection?.projectedNodeIds ?? new Set(),
      projectedTail: projection?.projectedTail ?? null,
      sessionId,
    }),
  )
}

describe('refreshing a Pi file that only grew', () => {
  it('takes appended usage entries as unchanged, from the appended bytes alone', async () => {
    const { manager, sessionId, file } = await projectedSession()
    manager.appendUsage('cache-warming', 'anthropic', 'claude-test', USAGE)
    manager.appendUsage('cache-warming', 'anthropic', 'claude-test', USAGE)
    vi.mocked(readFile).mockClear()

    const read = await readSnapshot(sessionId, file)
    expect(read.kind).toBe('unchanged')
    expect(filesRead()).not.toContain(file)
  })

  it('reads the file when a prompt was appended, and projects it as a full read would', async () => {
    const { manager, sessionId, file } = await projectedSession()
    manager.appendMessage({ role: 'user', content: [{ type: 'text', text: 'more' }], timestamp: 3 })
    answer(manager, 'more answers')

    const read = await readSnapshot(sessionId, file)
    expect(read.kind).toBe('changed')
    if (read.kind !== 'changed') return
    const full = projectPiSessionSnapshot({
      sessionManager: SessionManager.open(file, undefined, CWD),
    })
    expect(JSON.stringify(read.sessionSnapshot)).toBe(JSON.stringify(full))
    expect(read.fingerprint.tail?.lastEntryId).toBe(manager.getLeafId())
  })

  it('reads the whole file when the appended bytes end in a partial line', async () => {
    const { manager, sessionId, file } = await projectedSession()
    manager.appendUsage('cache-warming', 'anthropic', 'claude-test', USAGE)
    appendFileSync(file, '{"type":"usage"')
    vi.mocked(readFile).mockClear()

    await readSnapshot(sessionId, file)
    expect(filesRead()).toContain(file)
  })
})
