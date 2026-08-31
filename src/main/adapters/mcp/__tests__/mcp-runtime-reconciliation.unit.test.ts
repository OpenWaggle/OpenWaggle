import { Effect, Fiber } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import type { McpTurnStateServiceShape } from '../../../ports/mcp-turn-state-service'
import { makeMcpRuntimeService } from '../runtime/runtime-service-factory'
import {
  connection,
  createMcpRuntimeServiceForTests as createMcpRuntimeService,
  snapshot,
} from './mcp-runtime-test-utils'

describe('MCP runtime reconciliation ordering', () => {
  it('rejects an older Session snapshot after the lifecycle advances', async () => {
    const connect = vi.fn(async () => connection())
    const service = createMcpRuntimeService({ connect })
    const first = snapshot({ id: 'snapshot-a', revision: 'revision-a' })
    const next = snapshot({ id: 'snapshot-b', revision: 'revision-b' })

    await service.prepareTurn({ sessionId: first.sessionId, snapshot: first })
    await service.executeGateway(first, { operation: 'list' })
    await service.completeTurn({ sessionId: first.sessionId, nextSnapshot: next })

    await expect(service.executeGateway(first, { operation: 'list' })).rejects.toThrow(
      'no longer authoritative',
    )
    expect(connect).toHaveBeenCalledOnce()
    await service.executeGateway(next, { operation: 'list' })
    expect(connect).toHaveBeenCalledTimes(2)
    await service.disposeAll()
  })

  it('uses snapshot identity as well as revision for Session authority', async () => {
    const service = createMcpRuntimeService({ connect: async () => connection() })
    const first = snapshot({ id: 'snapshot-a', revision: 'shared-revision' })
    const next = snapshot({ id: 'snapshot-b', revision: 'shared-revision' })

    await service.prepareTurn({ sessionId: first.sessionId, snapshot: first })
    await service.completeTurn({ sessionId: first.sessionId, nextSnapshot: next })

    await expect(service.executeGateway(first, { operation: 'list' })).rejects.toThrow(
      'no longer authoritative',
    )
    await expect(service.executeGateway(next, { operation: 'list' })).resolves.toMatchObject({
      operation: 'list',
    })
    await service.disposeAll()
  })

  it('keeps disposed Session snapshots tombstoned', async () => {
    const connect = vi.fn(async () => connection())
    const service = createMcpRuntimeService({ connect })
    const turn = snapshot({ id: 'disposed-snapshot' })

    await service.prepareTurn({ sessionId: turn.sessionId, snapshot: turn })
    await service.disposeSession(turn.sessionId)

    await expect(service.executeGateway(turn, { operation: 'list' })).rejects.toThrow(
      'no longer authoritative',
    )
    expect(connect).not.toHaveBeenCalled()
    await service.disposeAll()
  })

  it('keeps independent capability readers concurrent', async () => {
    const started = vi.fn()
    let releaseReaders: (() => void) | undefined
    const readersRelease = new Promise<void>((resolve) => {
      releaseReaders = resolve
    })
    const service = createMcpRuntimeService({
      connect: async ({ snapshot: selectedSnapshot }) =>
        connection({
          capabilities: ['resources'],
          listResources: async () => {
            started(selectedSnapshot.runtimeNamespace)
            await readersRelease
            return { resources: [] }
          },
        }),
    })

    const first = service.browseCapabilities(
      snapshot({ runtimeNamespace: 'mcp-management:concurrent-first' }),
    )
    const second = service.browseCapabilities(
      snapshot({ runtimeNamespace: 'mcp-management:concurrent-second' }),
    )

    await vi.waitFor(() => expect(started).toHaveBeenCalledTimes(2))
    releaseReaders?.()
    await Promise.all([first, second])
    await service.disposeAll()
  })

  it('retains a read lease until an interrupted external MCP call settles', async () => {
    let releaseCall!: () => void
    let reportCallStarted!: () => void
    const callStarted = new Promise<void>((resolve) => {
      reportCallStarted = resolve
    })
    const callRelease = new Promise<void>((resolve) => {
      releaseCall = resolve
    })
    const rawService = Effect.runSync(
      makeMcpRuntimeService({
        connect: async () =>
          connection({
            callTool: async () => {
              reportCallStarted()
              await callRelease
              return { content: [{ type: 'text', text: 'done' }], isError: false }
            },
          }),
      }),
    )
    const management = snapshot({ runtimeNamespace: 'mcp-management:interrupt-barrier' })
    const callFiber = Effect.runFork(
      rawService.callAppTool({
        snapshot: management,
        serverInstanceId: 'server-1',
        toolName: 'search_private_docs',
        arguments: {},
      }),
    )
    await callStarted
    const interrupting = Effect.runPromise(Fiber.interrupt(callFiber))
    const reconciliationSettled = vi.fn()
    const reconciling = Effect.runPromise(rawService.reconcileIdleConnections()).then(
      reconciliationSettled,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(reconciliationSettled).not.toHaveBeenCalled()
    releaseCall()
    await Promise.all([interrupting, reconciling])
    expect(reconciliationSettled).toHaveBeenCalledOnce()
    await Effect.runPromise(rawService.disposeAll())
  })

  it('waits for an in-flight management capability before closing its connection', async () => {
    let releaseBrowse: (() => void) | undefined
    let reportBrowseStarted: (() => void) | undefined
    const browseStarted = new Promise<void>((resolve) => {
      reportBrowseStarted = resolve
    })
    const browseRelease = new Promise<void>((resolve) => {
      releaseBrowse = resolve
    })
    const close = vi.fn(async () => undefined)
    const service = createMcpRuntimeService({
      connect: async () =>
        connection({
          capabilities: ['resources'],
          close,
          listResources: async () => {
            reportBrowseStarted?.()
            await browseRelease
            return { resources: [] }
          },
        }),
    })
    const management = snapshot({ runtimeNamespace: 'mcp-management:/project' })

    const browsing = service.browseCapabilities(management)
    await browseStarted
    const reconciliationSettled = vi.fn()
    const reconciling = service.reconcileIdleConnections().then(reconciliationSettled)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(reconciliationSettled).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()

    releaseBrowse?.()
    await Promise.all([browsing, reconciling])

    expect(close).toHaveBeenCalledOnce()
    await expect(service.getConnectionStatuses()).resolves.toEqual([])
    await service.disposeAll()
  })

  it('admits a waiting reconciliation before later capability readers', async () => {
    let releaseFirstBrowse: (() => void) | undefined
    let reportFirstBrowseStarted: (() => void) | undefined
    const firstBrowseStarted = new Promise<void>((resolve) => {
      reportFirstBrowseStarted = resolve
    })
    const firstBrowseRelease = new Promise<void>((resolve) => {
      releaseFirstBrowse = resolve
    })
    const order: string[] = []
    const connect = vi
      .fn()
      .mockResolvedValueOnce(
        connection({
          capabilities: ['resources'],
          close: async () => {
            order.push('close-first')
          },
          listResources: async () => {
            reportFirstBrowseStarted?.()
            await firstBrowseRelease
            return { resources: [] }
          },
        }),
      )
      .mockImplementationOnce(async () => {
        order.push('connect-second')
        return connection({ capabilities: ['resources'] })
      })
    const service = createMcpRuntimeService({ connect })
    const firstSnapshot = snapshot({ runtimeNamespace: 'mcp-management:first' })
    const secondSnapshot = snapshot({ runtimeNamespace: 'mcp-management:second' })

    const firstBrowse = service.browseCapabilities(firstSnapshot)
    await firstBrowseStarted
    const reconciling = service.reconcileIdleConnections()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const secondBrowse = service.browseCapabilities(secondSnapshot)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(connect).toHaveBeenCalledOnce()

    releaseFirstBrowse?.()
    await firstBrowse
    await reconciling
    await secondBrowse

    expect(order).toEqual(['close-first', 'connect-second'])
    await service.disposeAll()
  })

  it('serializes turn completion while reconciliation records deferred invalidation', async () => {
    let active = true
    let releaseActiveRead: (() => void) | undefined
    let reportActiveRead: (() => void) | undefined
    const activeRead = new Promise<void>((resolve) => {
      reportActiveRead = resolve
    })
    const activeReadRelease = new Promise<void>((resolve) => {
      releaseActiveRead = resolve
    })
    const turnState: McpTurnStateServiceShape = {
      begin: () =>
        Effect.sync(() => {
          active = true
        }),
      complete: () =>
        Effect.sync(() => {
          active = false
        }),
      clear: () =>
        Effect.sync(() => {
          active = false
        }),
      getActive: () => Effect.succeed(undefined),
      activeSessions: () =>
        Effect.promise(async () => {
          const activeSnapshot = active ? new Set(['serialized-session']) : new Set<string>()
          reportActiveRead?.()
          await activeReadRelease
          return activeSnapshot
        }),
    }
    const close = vi.fn(async () => undefined)
    const connect = vi.fn(async () => connection({ close }))
    const service = createMcpRuntimeService({ connect, turnState })
    const turn = snapshot({ sessionId: 'serialized-session' })
    await service.executeGateway(turn, { operation: 'list' })

    const reconciling = service.reconcileIdleConnections()
    await activeRead
    const completionSettled = vi.fn()
    const completing = service
      .completeTurn({ sessionId: turn.sessionId, nextSnapshot: turn })
      .then(completionSettled)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(completionSettled).not.toHaveBeenCalled()

    releaseActiveRead?.()
    await Promise.all([reconciling, completing])
    expect(close).toHaveBeenCalledOnce()

    await service.executeGateway(turn, { operation: 'list' })
    expect(connect).toHaveBeenCalledTimes(2)
    await service.disposeAll()
  })

  it('does not admit a turn while idle reconciliation is closing its old connection', async () => {
    let releaseClose: (() => void) | undefined
    let reportCloseStarted: (() => void) | undefined
    const closeStarted = new Promise<void>((resolve) => {
      reportCloseStarted = resolve
    })
    const closeRelease = new Promise<void>((resolve) => {
      releaseClose = resolve
    })
    const close = vi.fn(async () => {
      reportCloseStarted?.()
      await closeRelease
    })
    const connect = vi.fn(async () => connection({ close }))
    const service = createMcpRuntimeService({ connect })
    const turn = snapshot({ sessionId: 'prepare-after-reconcile' })
    await service.executeGateway(turn, { operation: 'list' })

    const reconciling = service.reconcileIdleConnections()
    await closeStarted
    const preparationSettled = vi.fn()
    const preparing = service
      .prepareTurn({ sessionId: turn.sessionId, snapshot: turn })
      .then(preparationSettled)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(preparationSettled).not.toHaveBeenCalled()

    releaseClose?.()
    await Promise.all([reconciling, preparing])
    await service.executeGateway(turn, { operation: 'list' })
    expect(connect).toHaveBeenCalledTimes(2)
    await service.disposeAll()
  })
})
