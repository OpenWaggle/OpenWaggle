import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import type { DelegationState } from '@shared/types/session-collaboration'
import { describe, expect, it, vi } from 'vitest'
import { deleteProjectSessionsChildrenFirst } from '../sidebar-project-session-deletion'

function session(
  id: string,
  parentSessionId: SessionId | null,
  directWorkerCount: number,
  delegationState: DelegationState = 'accepted',
): SessionSummary {
  return {
    id: SessionId(id),
    title: id,
    projectPath: '/project',
    createdAt: 1,
    updatedAt: 1,
    lineage: {
      role: parentSessionId ? 'worker' : directWorkerCount > 0 ? 'queen' : 'independent',
      ...(parentSessionId ? { parentSessionId } : {}),
      directWorkerCount,
      activeDirectWorkerCount: directWorkerCount,
      ...(parentSessionId ? { agentDefinitionName: 'worker', delegationState } : {}),
    },
  }
}

describe('project Session deletion order', () => {
  it('deletes independent Sessions and Hives from leaves to Queen', async () => {
    const queen = session('queen', null, 1)
    const worker = session('worker', queen.id, 1)
    const grandchild = session('grandchild', worker.id, 0)
    const independent = session('independent', null, 0)
    const deletionOrder: string[] = []
    const deleteSession = vi.fn(async (sessionId: SessionId) => {
      deletionOrder.push(String(sessionId))
    })

    await deleteProjectSessionsChildrenFirst(
      [queen, worker, grandchild, independent],
      deleteSession,
    )

    expect(deletionOrder).toEqual(['grandchild', 'independent', 'worker', 'queen'])
  })

  it('rejects corrupt cyclic lineage instead of deleting an arbitrary Session', async () => {
    const first = session('first', SessionId('second'), 1)
    const second = session('second', SessionId('first'), 1)
    const deleteSession = vi.fn(async () => undefined)

    await expect(
      deleteProjectSessionsChildrenFirst(
        [session('sibling', null, 0), first, second],
        deleteSession,
      ),
    ).rejects.toThrow('Hive lineage contains a cycle')
    expect(deleteSession).not.toHaveBeenCalled()
  })

  it.each(['working', 'waiting'] as const)(
    'does not delete any sibling when a Worker is %s',
    async (delegationState) => {
      const activeWorker = session('worker', SessionId('queen'), 0, delegationState)
      const deleteSession = vi.fn(async () => undefined)

      await expect(
        deleteProjectSessionsChildrenFirst(
          [session('sibling', null, 0), activeWorker],
          deleteSession,
        ),
      ).rejects.toThrow('Stop this active Worker task')
      expect(deleteSession).not.toHaveBeenCalled()
    },
  )

  it('allows leaf-first removal of a historical Worker last recorded as working', async () => {
    const queen = session('queen', null, 1)
    const worker = session('worker', queen.id, 0, 'working')
    const lineage = worker.lineage
    if (!lineage) throw new Error('Worker fixture is missing lineage.')
    const deleteSession = vi.fn(async (_sessionId: SessionId) => undefined)

    await deleteProjectSessionsChildrenFirst(
      [queen, { ...worker, lineage: { ...lineage, historical: true } }],
      deleteSession,
    )

    expect(deleteSession.mock.calls.map(([id]) => id)).toEqual([worker.id, queen.id])
  })

  it('rejects missing project Workers before deleting a sibling', async () => {
    const deleteSession = vi.fn(async () => undefined)
    await expect(
      deleteProjectSessionsChildrenFirst(
        [session('sibling', null, 0), session('queen', null, 1)],
        deleteSession,
      ),
    ).rejects.toThrow('Workers outside the confirmed project')
    expect(deleteSession).not.toHaveBeenCalled()
  })
})
