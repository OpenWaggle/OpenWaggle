import { SESSION_DELETE_BLOCKED_ACTIVE_WORKER_MESSAGE } from '@shared/constants/session-lifecycle'
import { SessionId } from '@shared/types/brand'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { probeSessionLineageMutation as withSessionLineageMutation } from '../../adapters/__tests__/session-lineage-mutation-probe'
import {
  cancelSessionRunsMock,
  cleanupSessionRunMock,
  clearAgentPhaseMock,
  clearStreamBufferMock,
  deleteSessionMock,
  deleteVisualizationSessionMock,
  emitRunCompletedMock,
  getDeletionBlockerMock,
  loadSessionDetailsHandlers,
  removeSessionResourcesMock,
  resetSessionDetailsHandlerMocks,
  stageVisualizationSessionDeletionMock,
} from './session-details-handler.test-harness'
import { getInvokeHandler } from './session-details-handler.test-layers'

describe('session Hive deletion', () => {
  let registerSessionDetailsHandlers: Awaited<
    ReturnType<typeof loadSessionDetailsHandlers>
  >['registerSessionDetailsHandlers']

  beforeEach(async () => {
    resetSessionDetailsHandlerMocks()
    ;({ registerSessionDetailsHandlers } = await loadSessionDetailsHandlers())
  })

  it('preserves a Queen and its active run while direct Workers still belong to it', async () => {
    getDeletionBlockerMock.mockResolvedValue(
      "Delete this session's Workers before deleting their Queen session.",
    )
    cancelSessionRunsMock.mockReturnValue(true)

    registerSessionDetailsHandlers()
    const handler = getInvokeHandler('sessions:delete')

    await expect(handler?.({}, SessionId('queen-session'))).rejects.toThrow(
      "Delete this session's Workers before deleting their Queen session.",
    )

    expect(getDeletionBlockerMock).toHaveBeenCalledWith(SessionId('queen-session'))
    expect(cancelSessionRunsMock).not.toHaveBeenCalled()
    expect(clearAgentPhaseMock).not.toHaveBeenCalled()
    expect(clearStreamBufferMock).not.toHaveBeenCalled()
    expect(cleanupSessionRunMock).not.toHaveBeenCalled()
    expect(emitRunCompletedMock).not.toHaveBeenCalled()
    expect(deleteSessionMock).not.toHaveBeenCalled()
    expect(removeSessionResourcesMock).not.toHaveBeenCalled()
    expect(deleteVisualizationSessionMock).not.toHaveBeenCalled()
  })

  it.each(['working', 'waiting'])(
    'preserves a %s Worker when deletion is rejected',
    async (state) => {
      const id = SessionId(`${state}-worker`)
      const blocked = new Error(SESSION_DELETE_BLOCKED_ACTIVE_WORKER_MESSAGE)
      getDeletionBlockerMock.mockResolvedValue(SESSION_DELETE_BLOCKED_ACTIVE_WORKER_MESSAGE)
      deleteSessionMock.mockRejectedValue(blocked)
      cancelSessionRunsMock.mockReturnValue(true)
      registerSessionDetailsHandlers()

      await expect(getInvokeHandler('sessions:delete')?.({}, id)).rejects.toThrow(
        SESSION_DELETE_BLOCKED_ACTIVE_WORKER_MESSAGE,
      )

      expect(cancelSessionRunsMock).not.toHaveBeenCalled()
      expect(clearAgentPhaseMock).not.toHaveBeenCalled()
      expect(clearStreamBufferMock).not.toHaveBeenCalled()
      expect(cleanupSessionRunMock).not.toHaveBeenCalled()
      expect(emitRunCompletedMock).not.toHaveBeenCalled()
      expect(stageVisualizationSessionDeletionMock).not.toHaveBeenCalled()
      expect(deleteVisualizationSessionMock).not.toHaveBeenCalled()
      expect(removeSessionResourcesMock).not.toHaveBeenCalled()
      expect(deleteSessionMock).not.toHaveBeenCalled()
    },
  )

  it('does not perform cleanup when eligibility cannot be read', async () => {
    getDeletionBlockerMock.mockRejectedValue(new Error('Projection unavailable'))
    registerSessionDetailsHandlers()
    await expect(
      getInvokeHandler('sessions:delete')?.({}, SessionId('unreadable')),
    ).rejects.toThrow()
    expect(cancelSessionRunsMock).not.toHaveBeenCalled()
    expect(cleanupSessionRunMock).not.toHaveBeenCalled()
    expect(stageVisualizationSessionDeletionMock).not.toHaveBeenCalled()
    expect(deleteSessionMock).not.toHaveBeenCalled()
  })

  it('drains an admitted Hive update before deciding whether runtime cleanup is allowed', async () => {
    const id = SessionId('admitted-working-worker')
    const gate = Promise.withResolvers<void>()
    const admitted = withSessionLineageMutation([id], async () => {
      await gate.promise
      getDeletionBlockerMock.mockResolvedValue(SESSION_DELETE_BLOCKED_ACTIVE_WORKER_MESSAGE)
    })
    registerSessionDetailsHandlers()
    const deletion = getInvokeHandler('sessions:delete')?.({}, id)
    const rejected = expect(deletion).rejects.toThrow(SESSION_DELETE_BLOCKED_ACTIVE_WORKER_MESSAGE)
    expect(getDeletionBlockerMock).not.toHaveBeenCalled()
    gate.resolve()
    await admitted
    await rejected
    expect(cancelSessionRunsMock).not.toHaveBeenCalled()
    expect(cleanupSessionRunMock).not.toHaveBeenCalled()
    expect(stageVisualizationSessionDeletionMock).not.toHaveBeenCalled()
    await expect(withSessionLineageMutation([id], async () => undefined)).resolves.toBeUndefined()
  })

  it('rejects new Hive writes during staging before stopping the selected Session', async () => {
    const id = SessionId('late-worker')
    const staging = Promise.withResolvers<void>()
    stageVisualizationSessionDeletionMock.mockReturnValue(staging.promise)
    getDeletionBlockerMock.mockResolvedValue(null)
    registerSessionDetailsHandlers()
    const deletion = getInvokeHandler('sessions:delete')?.({}, id)
    await vi.waitFor(() => expect(stageVisualizationSessionDeletionMock).toHaveBeenCalledWith(id))
    const mutate = vi.fn(async () => undefined)
    await expect(withSessionLineageMutation([id], mutate)).rejects.toThrow(
      'Hive changes are blocked',
    )
    expect(mutate).not.toHaveBeenCalled()
    expect(cancelSessionRunsMock).not.toHaveBeenCalled()
    staging.resolve()
    await deletion
    expect(deleteSessionMock).toHaveBeenCalledWith(id)
    expect(cancelSessionRunsMock).toHaveBeenCalledWith(id)
    expect(deleteVisualizationSessionMock).toHaveBeenCalledWith(id)
    await expect(withSessionLineageMutation([id], mutate)).resolves.toBeUndefined()
  })

  it('leaves the run untouched when visualization staging fails', async () => {
    stageVisualizationSessionDeletionMock.mockRejectedValue(new Error('Files are locked'))
    registerSessionDetailsHandlers()
    await expect(
      getInvokeHandler('sessions:delete')?.({}, SessionId('stage-failure')),
    ).rejects.toThrow()
    expect(cancelSessionRunsMock).not.toHaveBeenCalled()
    expect(clearAgentPhaseMock).not.toHaveBeenCalled()
    expect(clearStreamBufferMock).not.toHaveBeenCalled()
    expect(cleanupSessionRunMock).not.toHaveBeenCalled()
    expect(deleteSessionMock).not.toHaveBeenCalled()
  })

  it('holds Hive admission until durable deletion finishes', async () => {
    const id = SessionId('eligible-running-session')
    const commit = Promise.withResolvers<void>()
    deleteSessionMock.mockReturnValue(commit.promise)
    registerSessionDetailsHandlers()
    const deletion = getInvokeHandler('sessions:delete')?.({}, id)
    await vi.waitFor(() => expect(deleteSessionMock).toHaveBeenCalledWith(id))
    await expect(withSessionLineageMutation([id], async () => undefined)).rejects.toThrow(
      'Hive changes are blocked',
    )
    commit.resolve()
    await deletion
    expect(cancelSessionRunsMock).toHaveBeenCalledWith(id)
    expect(clearAgentPhaseMock).toHaveBeenCalledWith(id)
    expect(clearStreamBufferMock).toHaveBeenCalledWith(id)
    expect(cleanupSessionRunMock).toHaveBeenCalledWith(id)
    await expect(withSessionLineageMutation([id], async () => undefined)).resolves.toBeUndefined()
  })
})
