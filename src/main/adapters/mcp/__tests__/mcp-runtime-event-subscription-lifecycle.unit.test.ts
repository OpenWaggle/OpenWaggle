import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import { makeMcpRuntimeState } from '../runtime/runtime-state'
import type { McpClientConnection } from '../runtime/types'
import {
  connection,
  createMcpRuntimeServiceForTests as createMcpRuntimeService,
  snapshot,
} from './mcp-runtime-test-utils'

const RETIRED_MESSAGE = 'MCP Event Inbox subscription was retired before activation completed.'
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

describe('MCP Event Inbox subscription lifecycle', () => {
  it('closes an in-flight acquisition that loses a race with connection teardown', async () => {
    const subscriptionStarted = Promise.withResolvers<void>()
    const releaseSubscription = Promise.withResolvers<void>()
    const connectionCloseStarted = Promise.withResolvers<void>()
    const closeSubscription = vi.fn(async () => undefined)
    const closeConnection = vi.fn(async () => connectionCloseStarted.resolve())
    const subscribeEvents = vi.fn<McpClientConnection['subscribeEvents']>(
      async ({ resourceUris }) => {
        subscriptionStarted.resolve()
        await releaseSubscription.promise
        return {
          mode: 'modern-listen',
          resourceUris,
          close: closeSubscription,
        }
      },
    )
    const state = Effect.runSync(
      makeMcpRuntimeState({
        connect: async () => connection({ subscribeEvents, close: closeConnection }),
      }),
    )
    const turn = snapshot()

    const activation = run(
      state.setEventSubscription({
        snapshot: turn,
        serverInstanceId: 'server-1',
        enabled: true,
        resourceUris: [],
      }),
    )
    await subscriptionStarted.promise
    const disposal = run(state.disposeSession(turn.sessionId))

    await connectionCloseStarted.promise
    expect(closeConnection).toHaveBeenCalledOnce()
    releaseSubscription.resolve()

    await disposal
    await expect(activation).rejects.toThrow(RETIRED_MESSAGE)
    expect(closeSubscription).toHaveBeenCalledOnce()
    expect(await run(state.getEventSubscriptions(turn.sessionId))).toEqual([])
  })

  it('prevents a mutation that began before teardown from reopening its connection', async () => {
    const currentSubscriptionCloseStarted = Promise.withResolvers<void>()
    const releaseCurrentSubscriptionClose = Promise.withResolvers<void>()
    const firstConnectionCloseStarted = Promise.withResolvers<void>()
    const releaseFirstConnectionClose = Promise.withResolvers<void>()
    const closeCurrentSubscription = vi.fn(async () => {
      currentSubscriptionCloseStarted.resolve()
      await releaseCurrentSubscriptionClose.promise
    })
    const closeUnexpectedSubscription = vi.fn(async () => undefined)
    const closeFirstConnection = vi.fn(async () => {
      firstConnectionCloseStarted.resolve()
      await releaseFirstConnectionClose.promise
    })
    const closeReopenedConnection = vi.fn(async () => undefined)
    let subscriptionIndex = 0
    const subscribeEvents = vi.fn<McpClientConnection['subscribeEvents']>(
      async ({ resourceUris }) => {
        const currentIndex = subscriptionIndex
        subscriptionIndex += 1
        return {
          mode: 'modern-listen',
          resourceUris,
          close: currentIndex === 0 ? closeCurrentSubscription : closeUnexpectedSubscription,
        }
      },
    )
    let connectionIndex = 0
    const connect = vi.fn(async () => {
      const currentIndex = connectionIndex
      connectionIndex += 1
      return connection({
        subscribeEvents,
        close: currentIndex === 0 ? closeFirstConnection : closeReopenedConnection,
      })
    })
    const state = Effect.runSync(makeMcpRuntimeState({ connect }))
    const turn = snapshot()

    await run(
      state.setEventSubscription({
        snapshot: turn,
        serverInstanceId: 'server-1',
        enabled: true,
        resourceUris: ['docs://first'],
      }),
    )
    const replacement = run(
      state.setEventSubscription({
        snapshot: turn,
        serverInstanceId: 'server-1',
        enabled: true,
        resourceUris: ['docs://replacement'],
      }),
    )
    const replacementRejection = expect(replacement).rejects.toThrow(RETIRED_MESSAGE)
    await currentSubscriptionCloseStarted.promise
    const disposal = run(state.disposeSession(turn.sessionId))
    await firstConnectionCloseStarted.promise

    releaseCurrentSubscriptionClose.resolve()
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(connect).toHaveBeenCalledOnce()
    releaseFirstConnectionClose.resolve()

    await disposal
    await replacementRejection
    expect(connect).toHaveBeenCalledOnce()
    expect(subscribeEvents).toHaveBeenCalledOnce()
    expect(closeCurrentSubscription).toHaveBeenCalledOnce()
    expect(closeUnexpectedSubscription).not.toHaveBeenCalled()
    expect(closeFirstConnection).toHaveBeenCalledOnce()
    expect(closeReopenedConnection).not.toHaveBeenCalled()
    expect(await run(state.getConnectionStatuses())).toEqual([])
    expect(await run(state.getEventSubscriptions(turn.sessionId))).toEqual([])
  })

  it('retires a queued pre-connect mutation across disposal and reactivation', async () => {
    const currentSubscriptionCloseStarted = Promise.withResolvers<void>()
    const releaseCurrentSubscriptionClose = Promise.withResolvers<void>()
    const connectionCloseStarted = Promise.withResolvers<void>()
    const releaseConnectionClose = Promise.withResolvers<void>()
    const closeSubscription = vi.fn(async () => {
      currentSubscriptionCloseStarted.resolve()
      await releaseCurrentSubscriptionClose.promise
    })
    const closeConnection = vi.fn(async () => {
      connectionCloseStarted.resolve()
      await releaseConnectionClose.promise
    })
    const subscribeEvents = vi.fn<McpClientConnection['subscribeEvents']>(
      async ({ resourceUris }) => ({
        mode: 'modern-listen',
        resourceUris,
        close: closeSubscription,
      }),
    )
    const connect = vi.fn(async () => connection({ subscribeEvents, close: closeConnection }))
    const state = Effect.runSync(makeMcpRuntimeState({ connect }))
    const turn = snapshot()

    await run(
      state.setEventSubscription({
        snapshot: turn,
        serverInstanceId: 'server-1',
        enabled: true,
        resourceUris: [],
      }),
    )
    const disabling = run(
      state.setEventSubscription({
        snapshot: turn,
        serverInstanceId: 'server-1',
        enabled: false,
        resourceUris: [],
      }),
    )
    const disablingRejection = expect(disabling).rejects.toThrow(RETIRED_MESSAGE)
    await currentSubscriptionCloseStarted.promise
    const queuedActivation = run(
      state.setEventSubscription({
        snapshot: turn,
        serverInstanceId: 'server-1',
        enabled: true,
        resourceUris: ['docs://queued'],
      }),
    )
    const queuedActivationRejection = expect(queuedActivation).rejects.toThrow(RETIRED_MESSAGE)
    await new Promise<void>((resolve) => setImmediate(resolve))
    const disposal = run(state.disposeSession(turn.sessionId))
    await connectionCloseStarted.promise
    await run(state.discardSupersededSessionConnections(turn))

    releaseCurrentSubscriptionClose.resolve()
    releaseConnectionClose.resolve()

    await disposal
    await Promise.all([disablingRejection, queuedActivationRejection])
    expect(connect).toHaveBeenCalledOnce()
    expect(subscribeEvents).toHaveBeenCalledOnce()
    expect(await run(state.getConnectionStatuses())).toEqual([])
    expect(await run(state.getEventSubscriptions(turn.sessionId))).toEqual([])
  })

  it('reactivates a disposed namespace explicitly without admitting an older generation', async () => {
    const connect = vi.fn(async () => connection())
    const state = Effect.runSync(makeMcpRuntimeState({ connect }))
    const turn = snapshot()

    await run(state.disposeSession(turn.sessionId))
    await expect(
      run(
        state.setEventSubscription({
          snapshot: turn,
          serverInstanceId: 'server-1',
          enabled: true,
          resourceUris: [],
        }),
      ),
    ).rejects.toThrow(RETIRED_MESSAGE)
    expect(connect).not.toHaveBeenCalled()

    await run(state.discardSupersededSessionConnections(turn))
    await expect(
      run(
        state.setEventSubscription({
          snapshot: turn,
          serverInstanceId: 'server-1',
          enabled: true,
          resourceUris: [],
        }),
      ),
    ).resolves.toMatchObject({ active: true })
    expect(connect).toHaveBeenCalledOnce()
    await run(state.disposeSession(turn.sessionId))
  })

  it('fences unknown namespaces after disposeAll until explicit reactivation', async () => {
    const connect = vi.fn(async () => connection())
    const state = Effect.runSync(makeMcpRuntimeState({ connect }))
    const turn = snapshot({ sessionId: 'post-dispose-all' })

    await run(state.disposeAll())
    await expect(
      run(
        state.setEventSubscription({
          snapshot: turn,
          serverInstanceId: 'server-1',
          enabled: true,
          resourceUris: [],
        }),
      ),
    ).rejects.toThrow(RETIRED_MESSAGE)
    expect(connect).not.toHaveBeenCalled()

    await run(state.discardSupersededSessionConnections(turn))
    await run(
      state.setEventSubscription({
        snapshot: turn,
        serverInstanceId: 'server-1',
        enabled: true,
        resourceUris: [],
      }),
    )
    expect(connect).toHaveBeenCalledOnce()
    await run(state.disposeAll())
  })

  it('lets lifecycle disposal close a subscription acquired by an admitted service call', async () => {
    const subscriptionStarted = Promise.withResolvers<void>()
    const releaseSubscription = Promise.withResolvers<void>()
    const closeSubscription = vi.fn(async () => undefined)
    const subscribeEvents = vi.fn<McpClientConnection['subscribeEvents']>(
      async ({ resourceUris }) => {
        subscriptionStarted.resolve()
        await releaseSubscription.promise
        return { mode: 'modern-listen', resourceUris, close: closeSubscription }
      },
    )
    const service = createMcpRuntimeService({
      connect: async () => connection({ subscribeEvents }),
    })
    const turn = snapshot()

    const activation = service.setEventSubscription({
      snapshot: turn,
      serverInstanceId: 'server-1',
      enabled: true,
      resourceUris: [],
    })
    await subscriptionStarted.promise
    const disposal = service.disposeSession(turn.sessionId)
    releaseSubscription.resolve()

    await Promise.all([activation, disposal])

    expect(closeSubscription).toHaveBeenCalledOnce()
    expect(await service.getEventSubscriptions(turn.sessionId)).toEqual([])
  })
})
