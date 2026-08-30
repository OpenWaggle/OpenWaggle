import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import type { McpTurnStateServiceShape } from '../../../ports/mcp-turn-state-service'
import {
  connection,
  createMcpRuntimeServiceForTests as createMcpRuntimeService,
  snapshot,
} from './mcp-runtime-test-utils'

describe('MCP runtime reconciliation ordering', () => {
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
