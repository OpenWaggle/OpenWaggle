import { SESSION_DELETE_BLOCKED_ACTIVE_WORKER_MESSAGE } from '@shared/constants/session-lifecycle'
import { SessionId } from '@shared/types/brand'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelSessionRunsMock,
  cleanupSessionRunMock,
  clearAgentPhaseMock,
  clearStreamBufferMock,
  deleteSessionMock,
  deleteVisualizationSessionMock,
  emitRunCompletedMock,
  getDeletionBlockerMock,
  getInvokeHandler,
  loadSessionDetailsHandlers,
  removeSessionResourcesMock,
  resetSessionDetailsHandlerMocks,
  rollbackVisualizationSessionDeletionMock,
  stageVisualizationSessionDeletionMock,
} from './session-details-handler.test-harness'

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

  it('preserves runtime state when repository revalidation rejects after async staging', async () => {
    const id = SessionId('late-worker')
    const staging = Promise.withResolvers<void>()
    stageVisualizationSessionDeletionMock.mockReturnValue(staging.promise)
    getDeletionBlockerMock.mockResolvedValue(null)
    deleteSessionMock.mockRejectedValue(new Error(SESSION_DELETE_BLOCKED_ACTIVE_WORKER_MESSAGE))
    registerSessionDetailsHandlers()
    const deletion = getInvokeHandler('sessions:delete')?.({}, id)
    const rejected = expect(deletion).rejects.toThrow()
    await vi.waitFor(() => expect(stageVisualizationSessionDeletionMock).toHaveBeenCalledWith(id))
    staging.resolve()
    await rejected
    expect(deleteSessionMock).toHaveBeenCalledWith(id)
    expect(rollbackVisualizationSessionDeletionMock).toHaveBeenCalledWith(id)
    expect(cancelSessionRunsMock).not.toHaveBeenCalled()
    expect(clearAgentPhaseMock).not.toHaveBeenCalled()
    expect(clearStreamBufferMock).not.toHaveBeenCalled()
    expect(cleanupSessionRunMock).not.toHaveBeenCalled()
    expect(emitRunCompletedMock).not.toHaveBeenCalled()
    expect(deleteVisualizationSessionMock).not.toHaveBeenCalled()
    expect(removeSessionResourcesMock).not.toHaveBeenCalled()
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

  it('waits for authoritative deletion before cancelling an eligible Session run', async () => {
    const id = SessionId('eligible-running-session')
    const commit = Promise.withResolvers<void>()
    deleteSessionMock.mockReturnValue(commit.promise)
    registerSessionDetailsHandlers()
    const deletion = getInvokeHandler('sessions:delete')?.({}, id)
    await vi.waitFor(() => expect(deleteSessionMock).toHaveBeenCalledWith(id))
    expect(cancelSessionRunsMock).not.toHaveBeenCalled()
    expect(cleanupSessionRunMock).not.toHaveBeenCalled()
    commit.resolve()
    await deletion
    expect(cancelSessionRunsMock).toHaveBeenCalledWith(id)
    expect(clearAgentPhaseMock).toHaveBeenCalledWith(id)
    expect(clearStreamBufferMock).toHaveBeenCalledWith(id)
    expect(cleanupSessionRunMock).toHaveBeenCalledWith(id)
  })
})
