import { SESSION_DELETE_BLOCKED_ACTIVE_WORKER_MESSAGE } from '@shared/constants/session-lifecycle'
import { SessionId } from '@shared/types/brand'
import { beforeEach, describe, expect, it } from 'vitest'
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

  it('keeps repository revalidation and rolls back staged assets after a late rejection', async () => {
    const id = SessionId('late-worker')
    getDeletionBlockerMock.mockResolvedValue(null)
    deleteSessionMock.mockRejectedValue(new Error(SESSION_DELETE_BLOCKED_ACTIVE_WORKER_MESSAGE))
    registerSessionDetailsHandlers()
    await expect(getInvokeHandler('sessions:delete')?.({}, id)).rejects.toThrow()
    expect(deleteSessionMock).toHaveBeenCalledWith(id)
    expect(rollbackVisualizationSessionDeletionMock).toHaveBeenCalledWith(id)
    expect(deleteVisualizationSessionMock).not.toHaveBeenCalled()
    expect(removeSessionResourcesMock).not.toHaveBeenCalled()
  })
})
