import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import { makeMcpRuntimeState } from '../runtime/runtime-state'
import type { McpClientConnection } from '../runtime/types'
import {
  connection,
  createMcpRuntimeServiceForTests as createMcpRuntimeService,
  snapshot,
} from './mcp-runtime-test-utils'

describe('MCP Event Inbox subscription concurrency', () => {
  it('linearizes concurrent replacements for the same connection key', async () => {
    const firstStarted = Promise.withResolvers<void>()
    const releaseFirst = Promise.withResolvers<void>()
    const firstClose = vi.fn(async () => undefined)
    const secondClose = vi.fn(async () => undefined)
    let subscriptionIndex = 0
    const subscribeEvents = vi.fn<McpClientConnection['subscribeEvents']>(
      async ({ resourceUris }) => {
        const currentIndex = subscriptionIndex
        subscriptionIndex += 1
        if (currentIndex === 0) {
          firstStarted.resolve()
          await releaseFirst.promise
        }
        return {
          mode: 'modern-listen',
          resourceUris,
          close: currentIndex === 0 ? firstClose : secondClose,
        }
      },
    )
    const service = createMcpRuntimeService({
      connect: async () => connection({ subscribeEvents }),
    })
    const turn = snapshot()

    const first = service.setEventSubscription({
      snapshot: turn,
      serverInstanceId: 'server-1',
      enabled: true,
      resourceUris: ['docs://first'],
    })
    await firstStarted.promise
    const second = service.setEventSubscription({
      snapshot: turn,
      serverInstanceId: 'server-1',
      enabled: true,
      resourceUris: ['docs://second'],
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    const callsBeforeFirstSettled = subscribeEvents.mock.calls.length

    releaseFirst.resolve()
    await Promise.all([first, second])

    expect(callsBeforeFirstSettled).toBe(1)
    expect(subscribeEvents).toHaveBeenCalledTimes(2)
    expect(firstClose).toHaveBeenCalledOnce()
    expect(secondClose).not.toHaveBeenCalled()
    expect(await service.getEventSubscriptions(turn.sessionId)).toEqual([
      expect.objectContaining({ resourceUris: ['docs://second'] }),
    ])

    await service.disposeAll()
    expect(firstClose).toHaveBeenCalledOnce()
    expect(secondClose).toHaveBeenCalledOnce()
  })

  it('allows acquisitions for unrelated connection keys to proceed concurrently', async () => {
    const firstStarted = Promise.withResolvers<void>()
    const releaseSubscriptions = Promise.withResolvers<void>()
    let subscriptionCount = 0
    const subscribeEvents = vi.fn<McpClientConnection['subscribeEvents']>(
      async ({ resourceUris }) => {
        subscriptionCount += 1
        if (subscriptionCount === 1) firstStarted.resolve()
        await releaseSubscriptions.promise
        return {
          mode: 'modern-listen',
          resourceUris,
          close: async () => undefined,
        }
      },
    )
    const service = createMcpRuntimeService({
      connect: async () => connection({ subscribeEvents }),
    })
    const firstTurn = snapshot()
    const secondTurn = snapshot({
      id: 'snapshot-2',
      sessionId: 'session-2',
      revision: 'revision-2',
    })

    const first = service.setEventSubscription({
      snapshot: firstTurn,
      serverInstanceId: 'server-1',
      enabled: true,
      resourceUris: ['docs://first'],
    })
    await firstStarted.promise
    const second = service.setEventSubscription({
      snapshot: secondTurn,
      serverInstanceId: 'server-1',
      enabled: true,
      resourceUris: ['docs://second'],
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    const callsBeforeRelease = subscribeEvents.mock.calls.length

    releaseSubscriptions.resolve()
    await Promise.all([first, second])

    expect(callsBeforeRelease).toBe(2)
    await service.disposeAll()
  })

  it('does not let stale subscription cleanup close a reactivated connection', async () => {
    const subscriptionStarted = Promise.withResolvers<void>()
    const releaseSubscription = Promise.withResolvers<void>()
    const oldConnectionCloseStarted = Promise.withResolvers<void>()
    const releaseOldConnectionClose = Promise.withResolvers<void>()
    const closeStaleSubscription = vi.fn(async () => undefined)
    const closeOldConnection = vi.fn(async () => {
      oldConnectionCloseStarted.resolve()
      await releaseOldConnectionClose.promise
    })
    const closeFreshConnection = vi.fn(async () => undefined)
    const subscribeEvents = vi.fn<McpClientConnection['subscribeEvents']>(
      async ({ resourceUris }) => {
        subscriptionStarted.resolve()
        await releaseSubscription.promise
        return { mode: 'modern-listen', resourceUris, close: closeStaleSubscription }
      },
    )
    const connect = vi
      .fn()
      .mockResolvedValueOnce(connection({ subscribeEvents, close: closeOldConnection }))
      .mockResolvedValueOnce(connection({ close: closeFreshConnection }))
    const state = Effect.runSync(makeMcpRuntimeState({ connect }))
    const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)
    const turn = snapshot()

    const staleActivation = run(
      state.setEventSubscription({
        snapshot: turn,
        serverInstanceId: 'server-1',
        enabled: true,
        resourceUris: [],
      }),
    )
    const staleRejection = expect(staleActivation).rejects.toThrow(
      'MCP Event Inbox subscription was retired before activation completed.',
    )
    await subscriptionStarted.promise
    const disposal = run(state.disposeSession(turn.sessionId))
    await oldConnectionCloseStarted.promise
    await run(state.discardSupersededSessionConnections(turn))
    releaseOldConnectionClose.resolve()
    await disposal

    await run(state.getConnectionForServer(turn, 'server-1'))
    releaseSubscription.resolve()
    await staleRejection

    expect(closeStaleSubscription).toHaveBeenCalledOnce()
    expect(closeFreshConnection).not.toHaveBeenCalled()
    expect(await run(state.getConnectionStatuses())).toEqual([
      expect.objectContaining({ connectionState: 'connected' }),
    ])
    await run(state.disposeAll())
    expect(closeFreshConnection).toHaveBeenCalledOnce()
  })
})
