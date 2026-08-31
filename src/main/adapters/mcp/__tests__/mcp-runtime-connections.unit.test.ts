import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import { makeMcpRuntimeConnections } from '../runtime/runtime-connections'
import type { McpClientConnection } from '../runtime/types'
import { connection, server, snapshot } from './mcp-runtime-test-utils'

function deferredConnection() {
  let resolve!: (connection: McpClientConnection) => void
  let reject!: (error: Error) => void
  const promise = new Promise<McpClientConnection>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createConnections(connect: () => Promise<McpClientConnection>) {
  const onClose = vi.fn(() => Effect.void)
  const onConnected = vi.fn(() => Effect.void)
  const service = Effect.runSync(makeMcpRuntimeConnections({ connect, onClose, onConnected }))
  return { service, onClose, onConnected }
}

describe('MCP runtime connection ownership', () => {
  it('self-closes a delayed retired connection before admitting a same-key replacement', async () => {
    const firstAttempt = deferredConnection()
    const closeFirst = vi.fn(async () => undefined)
    const replacement = connection()
    const connect = vi
      .fn<() => Promise<McpClientConnection>>()
      .mockImplementationOnce(() => firstAttempt.promise)
      .mockResolvedValueOnce(replacement)
    const { service, onConnected } = createConnections(connect)
    const turn = snapshot()
    const selected = server()

    const first = Effect.runPromise(service.get(turn, selected))
    await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce())
    const closing = Effect.runPromise(service.closeRuntimeNamespace(turn.sessionId))
    const second = Effect.runPromise(service.get(turn, selected))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(connect).toHaveBeenCalledOnce()

    firstAttempt.resolve(connection({ close: closeFirst }))

    await expect(first).rejects.toThrow('retired before it became ready')
    await closing
    await expect(second).resolves.toBe(replacement)
    expect(closeFirst).toHaveBeenCalledOnce()
    expect(onConnected).toHaveBeenCalledOnce()
    await expect(Effect.runPromise(service.getStatuses())).resolves.toMatchObject([
      { connectionState: 'connected', snapshotRevision: turn.revision },
    ])
    await Effect.runPromise(service.closeAll())
  })

  it('cannot let an older failed connector delete a later same-key cell', async () => {
    const firstAttempt = deferredConnection()
    const replacement = connection()
    const connect = vi
      .fn<() => Promise<McpClientConnection>>()
      .mockImplementationOnce(() => firstAttempt.promise)
      .mockResolvedValueOnce(replacement)
    const { service } = createConnections(connect)
    const turn = snapshot()
    const selected = server()

    const first = Effect.runPromise(service.get(turn, selected))
    await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce())
    const closing = Effect.runPromise(service.closeRuntimeNamespace(turn.sessionId))
    const second = Effect.runPromise(service.get(turn, selected))

    firstAttempt.reject(new Error('old connection failed'))

    await expect(first).rejects.toThrow('old connection failed')
    await closing
    await expect(second).resolves.toBe(replacement)
    await expect(Effect.runPromise(service.getStatuses())).resolves.toHaveLength(1)
    await Effect.runPromise(service.closeAll())
  })
})
