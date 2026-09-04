import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  archiveSession,
  createSession,
  establishSessionLineage,
  listArchivedSessions,
  setSessionDelegationState,
} from '../session-details'
import { listSessions } from '../sessions/session-list'

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
  state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-session-lineage-'))
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  const tmpDir = state.userDataDir
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('session Hive lineage projection', () => {
  it('projects parent, worker, state, counts, and archived lineage from SQLite', async () => {
    const parent = await createSession({
      projectPath: '/tmp/hive',
      piSessionId: 'parent-session',
    })
    const worker = await createSession({
      projectPath: '/tmp/hive',
      piSessionId: 'worker-session',
    })

    await establishSessionLineage({
      sessionId: worker.id,
      parentSessionId: parent.id,
      agentDefinitionName: 'reviewer',
      delegationState: 'working',
    })

    const active = await listSessions()
    expect(active.find(({ id }) => id === parent.id)?.lineage).toEqual({
      role: 'queen',
      parentSessionId: null,
      directWorkerCount: 1,
      activeDirectWorkerCount: 1,
      agentDefinitionName: null,
      delegationState: null,
    })
    expect(active.find(({ id }) => id === worker.id)?.lineage).toEqual({
      role: 'worker',
      parentSessionId: SessionId(String(parent.id)),
      directWorkerCount: 0,
      activeDirectWorkerCount: 0,
      agentDefinitionName: 'reviewer',
      delegationState: 'working',
    })

    await setSessionDelegationState(worker.id, 'accepted')
    await archiveSession(worker.id)

    const [parentAfterArchive] = await listSessions()
    expect(parentAfterArchive?.lineage?.activeDirectWorkerCount).toBe(0)
    const [archivedWorker] = await listArchivedSessions()
    expect(archivedWorker?.lineage).toMatchObject({
      role: 'worker',
      parentSessionId: parent.id,
      delegationState: 'accepted',
    })
  })
})
