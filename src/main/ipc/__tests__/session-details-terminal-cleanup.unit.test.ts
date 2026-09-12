import { SessionId } from '@shared/types/brand'
import { Cause, Layer, Runtime } from 'effect'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { probeSessionLineageMutation as withSessionLineageMutation } from '../../adapters/__tests__/session-lineage-mutation-probe'
import { TerminalService } from '../../ports/terminal-service'
import { ensureSessionRunStartAllowed, isSessionRemovalFenced } from '../active-agent-runs'
import {
  archiveSessionMock,
  deleteSessionMock,
  deleteVisualizationSessionMock,
  loadSessionDetailsHandlers,
  resetSessionDetailsHandlerMocks,
  rollbackVisualizationSessionDeletionMock,
  waitForSessionRunsMock,
} from './session-details-handler.test-harness'
import { getInvokeHandler } from './session-details-handler.test-layers'

const recordedCloseAllForOwner: Array<readonly [string, boolean]> = []
const lifecycleOrder: string[] = []
const mutationScopes: unknown[] = []
let terminalCleanupError: Error | null = null
let terminalHistoryCleanupError: Error | null = null
let terminalErrorsAreDefects = false
let interruptTerminalHistoryCleanup = false
let terminalStopBarrier: Promise<void> | null = null

const RecordingTerminalServiceLayer = Layer.succeed(
  TerminalService,
  TerminalService.of({
    getActivitySnapshot: () => Effect.succeed({ revision: 0, summaries: [], truncated: false }),
    open: () =>
      Effect.succeed({
        history: '',
        outputBytes: 0,
        outputGeneration: 0,
        readiness: null,
        running: false,
        processName: null,
        ports: [],
        projectActionPending: false,
      }),
    write: () => Effect.succeed({ status: 'written', acceptedBytes: 0 }),
    sendInputNow: () => Effect.succeed({ status: 'already-ready', releasedBytes: 0 }),
    acknowledgeOutput: () => Effect.void,
    migrateOwner: () => Effect.succeed({ terminalIds: [] }),
    resize: () => Effect.void,
    clear: () => Effect.void,
    restart: () =>
      Effect.succeed({
        history: '',
        outputBytes: 0,
        outputGeneration: 0,
        readiness: null,
        running: false,
        processName: null,
        ports: [],
        projectActionPending: false,
      }),
    assessClose: () => Effect.succeed({ disposition: 'safe', reason: 'dead' }),
    close: () => Effect.void,
    closeAllForOwner: (ownerKey, deleteHistory) => {
      recordedCloseAllForOwner.push([ownerKey, deleteHistory])
      lifecycleOrder.push(deleteHistory ? 'terminal:delete-history' : 'terminal:stop')
      if (deleteHistory && interruptTerminalHistoryCleanup) return Effect.interrupt
      const failure = deleteHistory ? terminalHistoryCleanupError : terminalCleanupError
      const result =
        failure === null
          ? Effect.void
          : terminalErrorsAreDefects
            ? Effect.promise(() => Promise.reject(failure))
            : Effect.fail(failure)
      return !deleteHistory && terminalStopBarrier !== null
        ? Effect.promise(() => terminalStopBarrier ?? Promise.resolve()).pipe(
            Effect.zipRight(result),
          )
        : result
    },
    closeAllUnderPath: () => Effect.void,
    runWithMutationFence: (scope, operation) => {
      mutationScopes.push(scope)
      return operation
    },
    attachSurface: () => Effect.void,
    detachTerminal: () => Effect.void,
    detachSurface: () => Effect.void,
    closeAll: () => Effect.void,
  }),
)

describe('session terminal cleanup', () => {
  let registerSessionDetailsHandlers: Awaited<
    ReturnType<typeof loadSessionDetailsHandlers>
  >['registerSessionDetailsHandlers']

  beforeEach(async () => {
    resetSessionDetailsHandlerMocks()
    deleteSessionMock.mockImplementation(async () => {
      lifecycleOrder.push('delete')
    })
    archiveSessionMock.mockImplementation(async () => {
      lifecycleOrder.push('archive')
    })
    recordedCloseAllForOwner.length = 0
    lifecycleOrder.length = 0
    mutationScopes.length = 0
    terminalCleanupError = null
    terminalHistoryCleanupError = null
    terminalErrorsAreDefects = false
    interruptTerminalHistoryCleanup = false
    terminalStopBarrier = null
    ;({ registerSessionDetailsHandlers } = await loadSessionDetailsHandlers())
  })

  it('closes the deleted session terminals and deletes their scrollback', async () => {
    registerSessionDetailsHandlers()
    const handler = getInvokeHandler('sessions:delete', [RecordingTerminalServiceLayer])

    await handler?.({}, 'session-delete')

    expect(recordedCloseAllForOwner).toEqual([
      ['session-delete', false],
      ['session-delete', true],
    ])
    expect(deleteSessionMock).toHaveBeenCalledWith('session-delete')
    expect(lifecycleOrder).toEqual(['terminal:stop', 'delete', 'terminal:delete-history'])
    expect(mutationScopes).toEqual([{ kind: 'owner', ownerKey: 'session-delete' }])
  })

  it('stops archived session terminals without deleting their scrollback', async () => {
    registerSessionDetailsHandlers()
    const handler = getInvokeHandler('sessions:archive', [RecordingTerminalServiceLayer])

    await handler?.({}, 'session-archive')

    expect(recordedCloseAllForOwner).toEqual([['session-archive', false]])
    expect(archiveSessionMock).toHaveBeenCalledWith('session-archive')
    expect(lifecycleOrder).toEqual(['terminal:stop', 'archive'])
    expect(mutationScopes).toEqual([{ kind: 'owner', ownerKey: 'session-archive' }])
  })

  it.each([
    ['delete', false, deleteSessionMock, false],
    ['archive', false, archiveSessionMock, false],
    ['delete', false, deleteSessionMock, true],
    ['archive', false, archiveSessionMock, true],
  ] as const)(
    'keeps the session when terminal cleanup blocks %s',
    async (mutation, deleteHistory, repositoryMutation, defect) => {
      terminalErrorsAreDefects = defect
      terminalCleanupError = new Error('process tree still running')
      registerSessionDetailsHandlers()
      const handler = getInvokeHandler(`sessions:${mutation}`, [RecordingTerminalServiceLayer])

      await expect(handler?.({}, `session-${mutation}`)).rejects.toThrow(
        'process tree still running',
      )

      expect(recordedCloseAllForOwner).toEqual([[`session-${mutation}`, deleteHistory]])
      expect(repositoryMutation).not.toHaveBeenCalled()
      expect(lifecycleOrder).toEqual(['terminal:stop'])
      if (mutation === 'delete') {
        expect(rollbackVisualizationSessionDeletionMock).toHaveBeenCalledWith('session-delete')
      }
      expect(isSessionRemovalFenced(SessionId(`session-${mutation}`))).toBe(false)
    },
  )

  it('waits for cancelled work to settle before terminal cleanup and deletion', async () => {
    const settlement = Promise.withResolvers<boolean>()
    waitForSessionRunsMock.mockReturnValue(settlement.promise)
    registerSessionDetailsHandlers()
    const handler = getInvokeHandler('sessions:delete', [RecordingTerminalServiceLayer])

    const deletion = handler?.({}, 'session-delete')
    await vi.waitFor(() => expect(waitForSessionRunsMock).toHaveBeenCalledOnce())
    await expect(
      withSessionLineageMutation([SessionId('session-delete')], async () => undefined),
    ).rejects.toThrow('Hive changes are blocked')
    expect(recordedCloseAllForOwner).toEqual([])
    expect(deleteSessionMock).not.toHaveBeenCalled()

    settlement.resolve(true)
    await deletion
    expect(lifecycleOrder).toEqual(['terminal:stop', 'delete', 'terminal:delete-history'])
  })

  it('rejects a run racing after settlement until durable deletion finishes', async () => {
    const stopped = Promise.withResolvers<void>()
    terminalStopBarrier = stopped.promise
    registerSessionDetailsHandlers()
    const handler = getInvokeHandler('sessions:delete', [RecordingTerminalServiceLayer])
    const sessionId = SessionId('session-delete-race')

    const deletion = handler?.({}, sessionId)
    await vi.waitFor(() => expect(recordedCloseAllForOwner).toEqual([[sessionId, false]]))

    expect(isSessionRemovalFenced(sessionId)).toBe(true)
    expect(deleteSessionMock).not.toHaveBeenCalled()
    await expect(Effect.runPromise(ensureSessionRunStartAllowed(sessionId))).rejects.toThrow(
      'being archived or deleted',
    )

    stopped.resolve()
    await deletion
    expect(isSessionRemovalFenced(sessionId)).toBe(false)
  })

  it.each([
    ['delete', deleteSessionMock],
    ['archive', archiveSessionMock],
  ] as const)(
    'retains Session metadata when cancelled %s work does not settle',
    async (mutation, repositoryMutation) => {
      waitForSessionRunsMock.mockResolvedValue(false)
      registerSessionDetailsHandlers()
      const handler = getInvokeHandler(`sessions:${mutation}`, [RecordingTerminalServiceLayer])

      await expect(handler?.({}, `session-${mutation}`)).rejects.toThrow('metadata was retained')

      expect(recordedCloseAllForOwner).toEqual([])
      expect(repositoryMutation).not.toHaveBeenCalled()
      expect(lifecycleOrder).toEqual([])
      expect(isSessionRemovalFenced(SessionId(`session-${mutation}`))).toBe(false)
      await expect(
        withSessionLineageMutation([SessionId(`session-${mutation}`)], async () => undefined),
      ).resolves.toBeUndefined()
    },
  )

  it('retains terminal history when durable session deletion fails', async () => {
    deleteSessionMock.mockImplementation(async () => {
      lifecycleOrder.push('delete')
      throw new Error('repository refused deletion')
    })
    registerSessionDetailsHandlers()
    const handler = getInvokeHandler('sessions:delete', [RecordingTerminalServiceLayer])

    await expect(handler?.({}, 'session-delete')).rejects.toThrow()

    expect(recordedCloseAllForOwner).toEqual([['session-delete', false]])
    expect(lifecycleOrder).toEqual(['terminal:stop', 'delete'])
    expect(rollbackVisualizationSessionDeletionMock).toHaveBeenCalledWith('session-delete')
    expect(deleteVisualizationSessionMock).not.toHaveBeenCalled()
    expect(isSessionRemovalFenced(SessionId('session-delete'))).toBe(false)
  })

  it('does not swallow an interruption during post-commit terminal cleanup', async () => {
    interruptTerminalHistoryCleanup = true
    registerSessionDetailsHandlers()
    const handler = getInvokeHandler('sessions:delete', [RecordingTerminalServiceLayer])
    const error: unknown = await handler?.({}, 'session-delete').catch((cause: unknown) => cause)
    expect(Runtime.isFiberFailure(error)).toBe(true)
    if (!Runtime.isFiberFailure(error)) throw new Error('Expected a FiberFailure')
    expect(Cause.isInterruptedOnly(error[Runtime.FiberFailureCauseId])).toBe(true)
    expect(deleteSessionMock).toHaveBeenCalledOnce()
    expect(isSessionRemovalFenced(SessionId('session-delete'))).toBe(false)
  })

  it.each([false, true])(
    'keeps committed deletion coherent for terminal defects=%s',
    async (defect) => {
      terminalErrorsAreDefects = defect
      terminalHistoryCleanupError = new Error('history cleanup failed')
      registerSessionDetailsHandlers()
      const handler = getInvokeHandler('sessions:delete', [RecordingTerminalServiceLayer])

      await expect(handler?.({}, 'session-delete')).resolves.toBeUndefined()

      expect(deleteSessionMock).toHaveBeenCalledWith('session-delete')
      expect(deleteVisualizationSessionMock).toHaveBeenCalledWith('session-delete')
      expect(rollbackVisualizationSessionDeletionMock).not.toHaveBeenCalled()
      expect(recordedCloseAllForOwner).toEqual([
        ['session-delete', false],
        ['session-delete', true],
      ])
      expect(lifecycleOrder).toEqual(['terminal:stop', 'delete', 'terminal:delete-history'])
      expect(isSessionRemovalFenced(SessionId('session-delete'))).toBe(false)
    },
  )
})
