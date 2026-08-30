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

import {
  activeWaggleRuns,
  cancelAllSessionRuns,
  reserveActiveSessionRun,
} from '../../application/active-session-runs'
import { registerWaggleHandlers } from '../waggle-handler'

const SESSION_ID = SessionId('session-1')
const SELECTED_MODEL = SupportedModelId('openai/gpt-5.4')

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
    dispatchLocalSessionCommandMock.mockReset()
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
        input.onTitleAssigned?.('Waggle title')
        return { outcome: 'success', newMessages: [] }
      }),
    )

    registerWaggleHandlers()
    await sendWaggle()

    expect(executeWaggleRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: SELECTED_MODEL }),
    )
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
    expect(publishSessionHostEventMock).toHaveBeenCalledWith({
      kind: 'session-list-changed',
      sessionId: SESSION_ID,
      change: 'updated',
    })
    expect(publishSessionHostEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'session-transport',
        sessionId: SESSION_ID,
        event: expect.objectContaining({ type: 'agent_end', reason: 'stop' }),
      }),
    )
  })

  it('refuses to start a local Waggle run while attached to another Session Host', async () => {
    isGuiAttachedToRemoteSessionHostMock.mockReturnValue(true)
    registerWaggleHandlers()
    await expect(sendWaggle()).rejects.toThrow('attached to another Session Host')
    expect(executeWaggleRunMock).not.toHaveBeenCalled()
  })

  it('waits for an interrupted classic Run to settle before starting explicit Waggle', async () => {
    executeWaggleRunMock.mockReturnValue(Effect.succeed({ outcome: 'success', newMessages: [] }))
    const classic = reserveActiveSessionRun(SESSION_ID, 'classic-run')
    registerWaggleHandlers()
    const sending = sendWaggle('Replace with Waggle')
    await vi.waitFor(() => expect(classic.controller.signal.aborted).toBe(true))
    expect(executeWaggleRunMock).not.toHaveBeenCalled()

    classic.release()
    await expect(sending).resolves.toMatchObject({ outcome: 'delivered' })
    expect(executeWaggleRunMock).toHaveBeenCalledOnce()
  })

  it('routes Waggle cancellation to the owning Session Host without cancelling local state', async () => {
    isGuiAttachedToRemoteSessionHostMock.mockReturnValue(true)
    const localController = new AbortController()
    const abort = vi.spyOn(localController, 'abort')
    activeWaggleRuns.register(SESSION_ID, localController, { runId: `waggle-${SESSION_ID}` })
    dispatchLocalSessionCommandMock
      .mockReturnValueOnce(
        Effect.succeed({
          contract: 'session-query-v2',
          response: {
            contractVersion: 2,
            requestId: 'status',
            outcome: {
              operation: 'status',
              sessionId: SESSION_ID,
              activeRunId: 'remote-run',
            },
          },
        }),
      )
      .mockReturnValueOnce(
        Effect.succeed({
          contract: 'session-control-v2',
          response: {
            contractVersion: 2,
            requestId: 'interrupt',
            idempotencyKey: 'interrupt',
            replayed: false,
            outcome: { operation: 'interrupt', effect: 'interruption-requested' },
          },
        }),
      )
    registerWaggleHandlers()
    const cancel = getCancelHandler()

    await Effect.runPromise(cancel({}, SESSION_ID))

    expect(abort).not.toHaveBeenCalled()
    expect(dispatchLocalSessionCommandMock).toHaveBeenCalledTimes(2)
    expect(dispatchLocalSessionCommandMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          request: expect.objectContaining({
            command: expect.objectContaining({
              operation: 'interrupt',
              sessionId: SESSION_ID,
              expectedRunId: 'remote-run',
            }),
          }),
        }),
      }),
    )
  })

  it('publishes worktree launch progress emitted by a Waggle first send', async () => {
    const progress = {
      stage: 'checking-out-files' as const,
      details: ['Checking out files'],
    }
    executeWaggleRunMock.mockImplementation((input) =>
      Effect.sync(() => {
        input.onWorktreeLaunch?.(progress)
        return { outcome: 'success', newMessages: [] }
      }),
    )

    registerWaggleHandlers()
    await sendWaggle()

    expect(emitWorktreeLaunchProgressMock).toHaveBeenCalledWith(SESSION_ID, progress)
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
