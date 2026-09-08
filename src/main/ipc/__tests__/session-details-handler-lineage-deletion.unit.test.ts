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
  getInvokeHandler,
  hasDirectWorkersMock,
  loadSessionDetailsHandlers,
  removeSessionResourcesMock,
  resetSessionDetailsHandlerMocks,
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
    hasDirectWorkersMock.mockResolvedValue(true)
    cancelSessionRunsMock.mockReturnValue(true)

    registerSessionDetailsHandlers()
    const handler = getInvokeHandler('sessions:delete')

    await expect(handler?.({}, SessionId('queen-session'))).rejects.toThrow(
      "Delete this session's Workers before deleting their Queen session.",
    )

    expect(hasDirectWorkersMock).toHaveBeenCalledWith(SessionId('queen-session'))
    expect(cancelSessionRunsMock).not.toHaveBeenCalled()
    expect(clearAgentPhaseMock).not.toHaveBeenCalled()
    expect(clearStreamBufferMock).not.toHaveBeenCalled()
    expect(cleanupSessionRunMock).not.toHaveBeenCalled()
    expect(emitRunCompletedMock).not.toHaveBeenCalled()
    expect(deleteSessionMock).not.toHaveBeenCalled()
    expect(removeSessionResourcesMock).not.toHaveBeenCalled()
    expect(deleteVisualizationSessionMock).not.toHaveBeenCalled()
  })
})
