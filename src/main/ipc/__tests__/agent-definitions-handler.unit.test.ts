import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { manageMock, typedHandleMock } = vi.hoisted(() => ({
  manageMock: vi.fn(() => Effect.succeed({ operation: 'list' as const, items: [] })),
  typedHandleMock: vi.fn(),
}))

vi.mock('../../application/host-ui-agent-definition-operation', () => ({
  manageHostUiAgentDefinitions: manageMock,
}))

vi.mock('../typed-ipc', () => ({ hostHandle: typedHandleMock, typedHandle: typedHandleMock }))

import { registerAgentDefinitionsHandlers } from '../agent-definitions-handler'

function manageHandler() {
  const call = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) =>
      candidate[0] === 'agent-definitions:manage' && typeof candidate[1] === 'function',
  )
  return typeof call?.[1] === 'function' ? call[1] : undefined
}

describe('Agent definition IPC handlers', () => {
  beforeEach(() => {
    manageMock.mockClear()
    typedHandleMock.mockClear()
  })

  it('delegates management to the Host-backed application operation with sender authority', async () => {
    registerAgentDefinitionsHandlers()
    const handler = manageHandler()
    const command = { operation: 'list', projectPath: '/tmp/project' }

    const result = await Effect.runPromise(handler?.({ sender: { id: 42 } }, command))

    expect(manageMock).toHaveBeenCalledWith({ senderId: 42, command })
    expect(result).toEqual({ operation: 'list', items: [] })
  })
})
