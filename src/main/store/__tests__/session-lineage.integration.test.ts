import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  SESSION_DELETE_BLOCKED_ACTIVE_WORKER_MESSAGE,
  SESSION_DELETE_BLOCKED_BY_WORKERS_MESSAGE,
} from '@shared/constants/session-lifecycle'
import { SessionId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  archiveSession,
  createSession,
  deleteSession,
  establishSessionLineage,
  getSessionDeletionBlocker,
  getSessionHiveRelations,
  hasDirectSessionWorkers,
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
  it('preflights active Workers and Queens without blocking eligible leaf Sessions', async () => {
    const queen = await createSession({ projectPath: '/tmp/hive', piSessionId: 'preflight-queen' })
    const worker = await createSession({
      projectPath: '/tmp/hive',
      piSessionId: 'preflight-worker',
    })
    const independent = await createSession({
      projectPath: '/tmp/hive',
      piSessionId: 'preflight-root',
    })
    await establishSessionLineage({
      sessionId: worker.id,
      parentSessionId: queen.id,
      agentDefinitionName: 'worker',
      delegationState: 'working',
    })
    expect(await getSessionDeletionBlocker(independent.id)).toBeNull()
    for (const state of ['working', 'waiting'] as const) {
      await setSessionDelegationState(worker.id, state)
      expect(await getSessionDeletionBlocker(worker.id)).toBe(
        SESSION_DELETE_BLOCKED_ACTIVE_WORKER_MESSAGE,
      )
      await expect(deleteSession(worker.id)).rejects.toThrow(
        SESSION_DELETE_BLOCKED_ACTIVE_WORKER_MESSAGE,
      )
    }
    for (const state of [
      'needs_attention',
      'ready_for_review',
      'revision_requested',
      'accepted',
      'cancelled',
    ] as const) {
      await setSessionDelegationState(worker.id, state)
      expect(await getSessionDeletionBlocker(worker.id)).toBeNull()
    }
    await archiveSession(worker.id)
    expect(await getSessionDeletionBlocker(queen.id)).toBe(
      SESSION_DELETE_BLOCKED_BY_WORKERS_MESSAGE,
    )
    expect(await getSessionDeletionBlocker(worker.id)).toBeNull()
    await deleteSession(worker.id)
    expect(await getSessionDeletionBlocker(queen.id)).toBeNull()
    await deleteSession(queen.id)
    await deleteSession(independent.id)
    expect(await listSessions()).toEqual([])
  })

  it('returns only the opened Session and its immediate Hive relatives', async () => {
    const queen = await createSession({
      projectPath: '/tmp/hive',
      piSessionId: 'bounded-hive-queen',
    })
    const activeWorker = await createSession({
      projectPath: '/tmp/hive',
      piSessionId: 'bounded-hive-active-worker',
    })
    const archivedWorker = await createSession({
      projectPath: '/tmp/hive',
      piSessionId: 'bounded-hive-archived-worker',
    })
    for (const [worker, state] of [
      [activeWorker, 'working'],
      [archivedWorker, 'accepted'],
    ] as const) {
      await establishSessionLineage({
        sessionId: worker.id,
        parentSessionId: queen.id,
        agentDefinitionName: 'reviewer',
        delegationState: state,
      })
    }
    await archiveSession(archivedWorker.id)

    const unrelatedArchivedIds: SessionId[] = []
    for (let index = 0; index < 12; index += 1) {
      const unrelated = await createSession({
        projectPath: '/tmp/unrelated',
        piSessionId: `unrelated-archived-${String(index)}`,
      })
      unrelatedArchivedIds.push(unrelated.id)
      await archiveSession(unrelated.id)
    }

    const relations = await getSessionHiveRelations(queen.id)
    expect(relations.current?.id).toBe(queen.id)
    expect(relations.parent).toBeNull()
    expect(relations.workers.map(({ id }) => id)).toEqual(
      expect.arrayContaining([activeWorker.id, archivedWorker.id]),
    )
    expect(relations.workers).toHaveLength(2)
    expect(relations.workers.find(({ id }) => id === archivedWorker.id)?.archived).toBe(true)

    const transferredIds = new Set([
      relations.current?.id,
      relations.parent?.id,
      ...relations.workers.map(({ id }) => id),
    ])
    for (const unrelatedId of unrelatedArchivedIds) {
      expect(transferredIds.has(unrelatedId)).toBe(false)
    }

    const workerRelations = await getSessionHiveRelations(activeWorker.id)
    expect(workerRelations.current?.id).toBe(activeWorker.id)
    expect(workerRelations.parent?.id).toBe(queen.id)
    expect(workerRelations.workers).toEqual([])
  })

  it('fails closed when delegation state is projected before worker lineage exists', async () => {
    const independent = await createSession({
      projectPath: '/tmp/hive',
      piSessionId: 'independent-session',
    })

    await expect(setSessionDelegationState(independent.id, 'accepted')).rejects.toThrow(
      'before Session lineage is established',
    )
    expect((await listSessions()).find(({ id }) => id === independent.id)?.lineage?.role).not.toBe(
      'worker',
    )
  })

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

  it('keeps a Queen until all direct Workers, including archived Workers, are deleted', async () => {
    const queen = await createSession({
      projectPath: '/tmp/hive',
      piSessionId: 'deletion-queen',
    })
    const activeWorker = await createSession({
      projectPath: '/tmp/hive',
      piSessionId: 'active-worker',
    })
    const doneWorker = await createSession({
      projectPath: '/tmp/hive',
      piSessionId: 'done-worker',
    })
    const archivedWorker = await createSession({
      projectPath: '/tmp/hive',
      piSessionId: 'archived-worker',
    })

    for (const [worker, state] of [
      [activeWorker, 'working'],
      [doneWorker, 'accepted'],
      [archivedWorker, 'accepted'],
    ] as const) {
      await establishSessionLineage({
        sessionId: worker.id,
        parentSessionId: queen.id,
        agentDefinitionName: 'reviewer',
        delegationState: state,
      })
    }
    await archiveSession(archivedWorker.id)

    expect(await hasDirectSessionWorkers(queen.id)).toBe(true)
    await expect(deleteSession(queen.id)).rejects.toThrow(
      "Delete this session's Workers before deleting their Queen session.",
    )

    const activeAfterBlockedDelete = await listSessions()
    expect(activeAfterBlockedDelete.map(({ id }) => id)).toEqual(
      expect.arrayContaining([queen.id, activeWorker.id, doneWorker.id]),
    )
    expect((await listArchivedSessions()).map(({ id }) => id)).toContain(archivedWorker.id)

    await expect(deleteSession(activeWorker.id)).rejects.toThrow(
      'Stop this active Worker task before deleting its Session.',
    )
    expect((await listSessions()).map(({ id }) => id)).toContain(activeWorker.id)
    await setSessionDelegationState(activeWorker.id, 'accepted')
    await deleteSession(activeWorker.id)
    await deleteSession(doneWorker.id)
    await deleteSession(archivedWorker.id)
    expect(await hasDirectSessionWorkers(queen.id)).toBe(false)
    await expect(deleteSession(queen.id)).resolves.toBeUndefined()
  })
})
