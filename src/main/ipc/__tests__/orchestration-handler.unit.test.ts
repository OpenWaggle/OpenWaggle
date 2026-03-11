import { ConversationId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  typedHandleMock,
  cancelActiveOrchestrationRunMock,
  getRunMock,
  listRunsMock,
  markCancelledMock,
} = vi.hoisted(() => ({
  typedHandleMock: vi.fn(),
  cancelActiveOrchestrationRunMock: vi.fn(),
  getRunMock: vi.fn(),
  listRunsMock: vi.fn(),
  markCancelledMock: vi.fn(),
}))

vi.mock('../typed-ipc', () => ({
  typedHandle: typedHandleMock,
}))

vi.mock('../../orchestration/active-runs', () => ({
  cancelActiveOrchestrationRun: cancelActiveOrchestrationRunMock,
}))

vi.mock('../../orchestration/run-repository', () => ({
  orchestrationRunRepository: {
    get: getRunMock,
    list: listRunsMock,
    markCancelled: markCancelledMock,
  },
}))

import { registerOrchestrationHandlers } from '../orchestration-handler'

function getInvokeHandler(name: string): ((...args: unknown[]) => Promise<unknown>) | undefined {
  const call = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) => candidate[0] === name && typeof candidate[1] === 'function',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    return undefined
  }

  return (...args: unknown[]) => Effect.runPromise(handler(...args))
}

describe('registerOrchestrationHandlers', () => {
  beforeEach(() => {
    typedHandleMock.mockReset()
    cancelActiveOrchestrationRunMock.mockReset()
    getRunMock.mockReset()
    listRunsMock.mockReset()
    markCancelledMock.mockReset()
  })

  it('registers all expected IPC channels', () => {
    registerOrchestrationHandlers()

    const channels = typedHandleMock.mock.calls.map((args: unknown[]) => args[0])
    expect(channels).toContain('orchestration:get-run')
    expect(channels).toContain('orchestration:list-runs')
    expect(channels).toContain('orchestration:cancel-run')
  })

  it('loads a single orchestration run by id', async () => {
    const record = { runId: 'run-1', status: 'completed' }
    getRunMock.mockResolvedValue(record)

    registerOrchestrationHandlers()
    const handler = getInvokeHandler('orchestration:get-run')

    const result = await handler?.({}, 'run-1')
    expect(result).toEqual(record)
    expect(getRunMock).toHaveBeenCalledWith('run-1')
  })

  it('lists orchestration runs for the active conversation', async () => {
    const records = [{ runId: 'run-1' }, { runId: 'run-2' }]
    listRunsMock.mockResolvedValue(records)

    registerOrchestrationHandlers()
    const handler = getInvokeHandler('orchestration:list-runs')

    const result = await handler?.({}, ConversationId('conv-1'))
    expect(result).toEqual(records)
    expect(listRunsMock).toHaveBeenCalledWith(ConversationId('conv-1'))
  })

  it('skips repository cancellation when the active run was cancelled in memory', async () => {
    cancelActiveOrchestrationRunMock.mockReturnValue(true)

    registerOrchestrationHandlers()
    const handler = getInvokeHandler('orchestration:cancel-run')

    await handler?.({}, 'run-active')

    expect(cancelActiveOrchestrationRunMock).toHaveBeenCalledWith('run-active')
    expect(markCancelledMock).not.toHaveBeenCalled()
  })

  it('marks the run cancelled in the repository when no active run exists', async () => {
    cancelActiveOrchestrationRunMock.mockReturnValue(false)
    markCancelledMock.mockResolvedValue(undefined)

    registerOrchestrationHandlers()
    const handler = getInvokeHandler('orchestration:cancel-run')

    await handler?.({}, 'run-persisted')

    expect(cancelActiveOrchestrationRunMock).toHaveBeenCalledWith('run-persisted')
    expect(markCancelledMock).toHaveBeenCalledWith('run-persisted', 'cancelled-by-user')
  })
})
