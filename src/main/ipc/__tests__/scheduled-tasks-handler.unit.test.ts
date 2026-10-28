import type { ScheduledTasksOutcome } from '@shared/types/scheduled-task'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { dispatchLocalSessionCommandMock, typedHandleMock } = vi.hoisted(() => ({
  dispatchLocalSessionCommandMock: vi.fn(),
  typedHandleMock: vi.fn(),
}))

vi.mock('../typed-ipc', async () => {
  const { withLegacyHostOperation } = await import('./legacy-host-operations')
  return { hostHandle: withLegacyHostOperation(typedHandleMock), typedHandle: typedHandleMock }
})
vi.mock('../../application/local-session-command-dispatcher', () => ({
  dispatchLocalSessionCommand: dispatchLocalSessionCommandMock,
}))
vi.mock('../../application/gui-session-command', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../application/gui-session-command')>()),
  dispatchGuiSessionCommand: dispatchLocalSessionCommandMock,
}))

import { registerScheduledTasksHandlers } from '../scheduled-tasks-handler'

function executeHandler() {
  registerScheduledTasksHandlers()
  const call = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) => candidate[0] === 'scheduled-tasks:execute',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') throw new Error('Expected scheduled-tasks:execute handler')
  return (...args: unknown[]) =>
    Effect.runPromise(
      Effect.either(
        Effect.suspend((): Effect.Effect<ScheduledTasksOutcome, unknown> => handler({}, ...args)),
      ),
    )
}

function dispatchedRequest() {
  const input: unknown = dispatchLocalSessionCommandMock.mock.calls[0]?.[0]
  return input
}

/** Echo the requestId the handler generated, as the Host does. */
function respondWith(outcome: ScheduledTasksOutcome, contract = 'scheduled-tasks-v1') {
  dispatchLocalSessionCommandMock.mockImplementation(
    (input: { readonly payload: { readonly request: { readonly requestId: string } } }) =>
      Effect.succeed({
        contract,
        response: {
          contractVersion: 1,
          requestId: input.payload.request.requestId,
          operation: 'list',
          outcome,
        },
      }),
  )
}

describe('scheduled-tasks:execute IPC handler', () => {
  beforeEach(() => {
    dispatchLocalSessionCommandMock.mockReset()
    typedHandleMock.mockReset()
  })

  it('dispatches the command as the local GUI user and returns the outcome', async () => {
    respondWith({ effect: 'listed', tasks: [] })
    const result = await executeHandler()({ operation: 'list' }, 'key-1')

    expect(result).toMatchObject({ _tag: 'Right', right: { effect: 'listed', tasks: [] } })
    expect(dispatchedRequest()).toEqual({
      caller: { callerId: 'gui:local-user' },
      payload: {
        contract: 'scheduled-tasks-v1',
        request: {
          contractVersion: 1,
          requestId: expect.any(String),
          idempotencyKey: 'key-1',
          command: { operation: 'list' },
        },
      },
    })
  })

  it('omits an absent idempotency key', async () => {
    respondWith({ effect: 'deleted', taskId: 'task-1' })
    await executeHandler()({ operation: 'delete', taskId: 'task-1' })

    expect(dispatchedRequest()).toMatchObject({
      payload: { request: { command: { operation: 'delete', taskId: 'task-1' } } },
    })
    expect(JSON.stringify(dispatchedRequest())).not.toContain('idempotencyKey')
  })

  it('rejects a malformed renderer command before reaching the Host', async () => {
    const result = await executeHandler()({ operation: 'run-now' })

    expect(result._tag).toBe('Left')
    expect(String(result._tag === 'Left' ? result.left : '')).toContain(
      'Invalid Scheduled tasks command',
    )
    expect(dispatchLocalSessionCommandMock).not.toHaveBeenCalled()
  })

  it('rejects a response for another contract', async () => {
    respondWith({ effect: 'listed', tasks: [] }, 'session-control-v2')
    const result = await executeHandler()({ operation: 'list' })

    expect(result._tag).toBe('Left')
  })

  it('rejects a response for another request', async () => {
    dispatchLocalSessionCommandMock.mockReturnValue(
      Effect.succeed({
        contract: 'scheduled-tasks-v1',
        response: {
          contractVersion: 1,
          requestId: 'someone-else',
          operation: 'list',
          outcome: { effect: 'listed', tasks: [] },
        },
      }),
    )
    const result = await executeHandler()({ operation: 'list' })

    expect(result._tag).toBe('Left')
  })
})
