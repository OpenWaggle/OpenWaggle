import { SessionId, SupportedModelId } from '@shared/types/brand'
import { WAGGLE_INHERIT_MODEL, type WaggleConfig } from '@shared/types/waggle'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  emitWorktreeLaunchFailureMock,
  emitWorktreeLaunchProgressMock,
  executeWaggleRunMock,
  acquireSessionHostRunLeaseMock,
  isGuiAttachedToRemoteSessionHostMock,
  publishSessionHostEventMock,
  settleExternalSessionRunMock,
  activatePreparedExternalSessionRunMock,
  prepareExternalSessionRunReplacementMock,
  dispatchLocalSessionCommandMock,
  attachmentBindMock,
  attachmentCleanupMock,
  typedHandleMock,
  typedOnMock,
} = vi.hoisted(() => ({
  emitWorktreeLaunchFailureMock: vi.fn(),
  emitWorktreeLaunchProgressMock: vi.fn(),
  executeWaggleRunMock: vi.fn(),
  acquireSessionHostRunLeaseMock: vi.fn(),
  isGuiAttachedToRemoteSessionHostMock: vi.fn(() => false),
  publishSessionHostEventMock: vi.fn(),
  settleExternalSessionRunMock: vi.fn(),
  activatePreparedExternalSessionRunMock: vi.fn(),
  prepareExternalSessionRunReplacementMock: vi.fn(),
  dispatchLocalSessionCommandMock: vi.fn(),
  attachmentBindMock: vi.fn(),
  attachmentCleanupMock: vi.fn(),
  typedHandleMock: vi.fn(),
  typedOnMock: vi.fn(),
}))

vi.mock('../typed-ipc', () => ({
  typedHandle: typedHandleMock,
  typedOn: typedOnMock,
}))

vi.mock('../../application/waggle-run-service', () => ({
  executeWaggleRun: executeWaggleRunMock,
}))

vi.mock('../../application/local-session-command-dispatcher', () => ({
  dispatchLocalSessionCommand: dispatchLocalSessionCommandMock,
}))

vi.mock('../../application/session-external-run-coordinator', () => ({
  activatePreparedExternalSessionRun: activatePreparedExternalSessionRunMock,
  prepareExternalSessionRunReplacement: prepareExternalSessionRunReplacementMock,
  settleExternalSessionRun: settleExternalSessionRunMock,
}))

vi.mock('../../utils/stream-bridge', () => ({
  emitWorktreeLaunchFailure: emitWorktreeLaunchFailureMock,
  emitWorktreeLaunchProgress: emitWorktreeLaunchProgressMock,
}))

vi.mock('../../application/session-host-run-admission', () => ({
  acquireSessionHostRunLease: acquireSessionHostRunLeaseMock,
}))

vi.mock('../../application/session-control-run-coordinator', () => ({
  coordinateSessionRuns: vi.fn(() => Effect.void),
}))

vi.mock('../../application/session-run-coordinator-supervision', () => ({
  forkSupervisedSessionRuns: vi.fn(() => Effect.void),
}))

vi.mock('../../session-host/gui-session-host-state', () => ({
  isGuiAttachedToRemoteSessionHost: isGuiAttachedToRemoteSessionHostMock,
}))

vi.mock('../../session-host/session-host-events', () => ({
  publishSessionHostEvent: publishSessionHostEventMock,
  tryGetSessionHostEventRuntime: vi.fn(() => null),
}))

import { cancelAllSessionRuns } from '../../application/active-session-runs'
import { executeExplicitWaggleCancellation } from '../../application/explicit-waggle-command-cancellation'
import { executeExplicitWaggleCommand } from '../../application/explicit-waggle-command-service'
import { SessionControlAttachmentService } from '../../ports/session-control-attachment-service'
import { registerWaggleHandlers } from '../waggle-handler'

const SESSION_ID = SessionId('session-1')
const SELECTED_MODEL = SupportedModelId('openai/gpt-5.4')
const attachmentService = SessionControlAttachmentService.of({
  prepare: () => Effect.die('unused'),
  bind: attachmentBindMock,
  cleanupUnreferenced: attachmentCleanupMock,
  resolve: () => Effect.die('unused'),
  release: () => Effect.die('unused'),
})

function inheritedFirstAgentConfig(): WaggleConfig {
  return {
    mode: 'sequential',
    agents: [
      {
        label: 'Architect',
        model: WAGGLE_INHERIT_MODEL,
        roleDescription: 'Plans the implementation',
        color: 'blue',
      },
      {
        label: 'Reviewer',
        model: SupportedModelId('anthropic/claude-sonnet-4-5'),
        roleDescription: 'Reviews the implementation',
        color: 'amber',
      },
    ],
    stop: { primary: 'consensus', maxTurnsSafety: 4 },
  }
}

function getSendHandler() {
  const call = typedHandleMock.mock.calls.find(
    (args: readonly unknown[]) => args[0] === 'agent:send-waggle-message',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    throw new Error('Expected agent:send-waggle-message handler to be registered')
  }
  return handler
}

function getCancelHandler() {
  const call = typedOnMock.mock.calls.find(
    (args: readonly unknown[]) => args[0] === 'agent:cancel-waggle',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    throw new Error('Expected agent:cancel-waggle handler to be registered')
  }
  return handler
}

function sendWaggle(text = 'Review this patch') {
  return Effect.runPromise(
    getSendHandler()(
      {},
      SESSION_ID,
      { text, thinkingLevel: 'medium', attachments: [] },
      SELECTED_MODEL,
      inheritedFirstAgentConfig(),
    ),
  )
}

describe('registerWaggleHandlers', () => {
  beforeEach(() => {
    cancelAllSessionRuns()
    emitWorktreeLaunchFailureMock.mockReset()
    emitWorktreeLaunchProgressMock.mockReset()
    executeWaggleRunMock.mockReset()
    acquireSessionHostRunLeaseMock.mockReset().mockReturnValue(Effect.succeed({ release: vi.fn() }))
    isGuiAttachedToRemoteSessionHostMock.mockReset().mockReturnValue(false)
    publishSessionHostEventMock.mockReset()
    settleExternalSessionRunMock
      .mockReset()
      .mockReturnValue(Effect.succeed({ accepted: true, stateRevision: 3 }))
    prepareExternalSessionRunReplacementMock
      .mockReset()
      .mockReturnValue(Effect.succeed({ accepted: true, stateRevision: 2, intent: {} }))
    activatePreparedExternalSessionRunMock
      .mockReset()
      .mockReturnValue(Effect.succeed({ accepted: true, stateRevision: 3, intent: {} }))
    dispatchLocalSessionCommandMock
      .mockReset()
      .mockImplementation((input) =>
        executeExplicitWaggleCommand(input).pipe(
          Effect.provideService(SessionControlAttachmentService, attachmentService),
        ),
      )
    attachmentBindMock.mockReset().mockReturnValue(Effect.void)
    attachmentCleanupMock.mockReset().mockReturnValue(Effect.void)
    typedHandleMock.mockReset()
    typedOnMock.mockReset()
  })

  it('starts the Waggle stream buffer with the resolved runtime model for inherited first-agent runs', async () => {
    executeWaggleRunMock.mockImplementation((input) =>
      Effect.sync(() => {
        input.onRunPrepared?.(SELECTED_MODEL)
        input.onEvent?.(
          { type: 'agent_end', runId: 'nested-waggle', reason: 'stop', timestamp: 2 },
          { agentIndex: 0, agentLabel: 'Architect', turn: 1 },
        )
        input.onTurnEvent?.({ type: 'collaboration-completed', sessionId: SESSION_ID })
        return { outcome: 'success', newMessages: [] }
      }),
    )

    registerWaggleHandlers()
    await sendWaggle()

    expect(publishSessionHostEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'session-transport',
        sessionId: SESSION_ID,
        event: expect.objectContaining({ type: 'agent_start', model: SELECTED_MODEL }),
      }),
    )
    expect(publishSessionHostEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'session-waggle-transport', sessionId: SESSION_ID }),
    )
    expect(publishSessionHostEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'session-waggle-turn', sessionId: SESSION_ID }),
    )
  })

  it('routes the exact explicit Waggle request through the owning Session Host', async () => {
    isGuiAttachedToRemoteSessionHostMock.mockReturnValue(true)
    dispatchLocalSessionCommandMock.mockImplementationOnce((input) =>
      Effect.succeed({
        contract: 'session-waggle-v1',
        response: {
          contractVersion: 1,
          requestId: input.payload.request.requestId,
          idempotencyKey: input.payload.request.idempotencyKey,
          replayed: false,
          report: { outcome: 'delivered' },
        },
      }),
    )
    registerWaggleHandlers()
    await expect(sendWaggle()).resolves.toEqual({ outcome: 'delivered' })
    expect(executeWaggleRunMock).not.toHaveBeenCalled()
    const command = dispatchLocalSessionCommandMock.mock.calls[0]?.[0]
    expect(command).toMatchObject({
      caller: { callerId: 'gui:local-user' },
      payload: { contract: 'session-waggle-v1' },
    })
    expect(command.payload.request).toMatchObject({
      sessionId: SESSION_ID,
      model: SELECTED_MODEL,
      config: inheritedFirstAgentConfig(),
      payload: { text: 'Review this patch' },
    })
  })

  it('cancels an owner-side Waggle while durable replacement preparation is pending', async () => {
    isGuiAttachedToRemoteSessionHostMock.mockReturnValue(true)
    const preparation = Promise.withResolvers<{
      accepted: true
      stateRevision: number
      intent: Record<string, never>
    }>()
    prepareExternalSessionRunReplacementMock.mockReturnValue(
      Effect.promise(() => preparation.promise),
    )
    dispatchLocalSessionCommandMock.mockImplementation((input) => {
      const command = input.payload
      if (command.contract === 'session-waggle-v1') {
        return executeExplicitWaggleCommand({ caller: input.caller, payload: command }).pipe(
          Effect.provideService(SessionControlAttachmentService, attachmentService),
        )
      }
      if (command.contract === 'session-waggle-cancel-v1') {
        return executeExplicitWaggleCancellation({ caller: input.caller, payload: command })
      }
      return Effect.die('unexpected command')
    })
    registerWaggleHandlers()

    const running = sendWaggle()
    await vi.waitFor(() => expect(prepareExternalSessionRunReplacementMock).toHaveBeenCalledOnce())
    await Effect.runPromise(getCancelHandler()({}, SESSION_ID))
    preparation.resolve({ accepted: true, stateRevision: 2, intent: {} })

    await expect(running).rejects.toThrow()
    expect(executeWaggleRunMock).not.toHaveBeenCalled()
    expect(dispatchLocalSessionCommandMock).toHaveBeenCalledTimes(2)
    expect(dispatchLocalSessionCommandMock.mock.calls[1]?.[0]).toMatchObject({
      payload: { contract: 'session-waggle-cancel-v1', request: { sessionId: SESSION_ID } },
    })
  })

  it('marks an in-progress Waggle worktree launch as failed when setup is refused', async () => {
    executeWaggleRunMock.mockReturnValue(
      Effect.succeed({
        outcome: 'error',
        message: 'Could not create worktree',
        code: 'worktree-creation-failed',
      }),
    )

    registerWaggleHandlers()
    await sendWaggle()

    expect(emitWorktreeLaunchFailureMock).toHaveBeenCalledWith(
      SESSION_ID,
      'Could not create worktree',
    )
  })
})
