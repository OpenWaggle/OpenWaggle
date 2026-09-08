import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { describe, expect, it, vi } from 'vitest'
import { deleteProjectSessionsChildrenFirst } from '../sidebar-project-session-deletion'

function session(
  id: string,
  parentSessionId: SessionId | null,
  directWorkerCount: number,
): SessionSummary {
  return {
    id: SessionId(id),
    title: id,
    projectPath: '/project',
    createdAt: 1,
    updatedAt: 1,
    lineage: {
      role: parentSessionId ? 'worker' : directWorkerCount > 0 ? 'queen' : 'independent',
      parentSessionId,
      directWorkerCount,
      activeDirectWorkerCount: directWorkerCount,
      agentDefinitionName: parentSessionId ? 'worker' : null,
      delegationState: parentSessionId ? 'working' : null,
    },
  }
}

describe('project Session deletion order', () => {
  it('deletes independent Sessions in parallel and Hives from leaves to Queen', async () => {
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
      deleteProjectSessionsChildrenFirst([first, second], deleteSession),
    ).rejects.toThrow('Hive lineage contains a cycle')
    expect(deleteSession).not.toHaveBeenCalled()
  })
})
