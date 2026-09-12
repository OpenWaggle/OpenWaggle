import type { Message } from '@shared/types/agent'
import { MessageId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { acquireSessionRemovalFence, activeRuns, activeWaggleRuns } from '../active-agent-runs'
import {
  handoffMessage,
  MODEL,
  mocks,
  PAYLOAD,
  registerHandlers,
  resetAgentHandlerMocks,
  SESSION_ID,
} from './agent-handler-waggle-handoff.test-harness'

describe('agent handler Waggle handoff lifecycle', () => {
  beforeEach(resetAgentHandlerMocks)

  it('chains the durable standard result into Waggle and cleans both registries', async () => {
    mocks.executeAgentRun.mockReturnValue(
      Effect.succeed({ outcome: 'success', newMessages: [handoffMessage()] }),
    )
    mocks.executeWaggleRun.mockImplementation((input) =>
      Effect.sync(() => {
        input.onRunPrepared(MODEL)
        return { outcome: 'success', newMessages: [] }
      }),
    )
    const { send } = registerHandlers()

    await Effect.runPromise(send({}, SESSION_ID, PAYLOAD, MODEL))

    expect(mocks.executeAgentRun).toHaveBeenCalledBefore(mocks.executeWaggleRun)
    expect(mocks.startStreamBuffer.mock.calls).toEqual([
      [SESSION_ID, MODEL, 'classic'],
      [SESSION_ID, MODEL, 'waggle'],
    ])
    expect(mocks.emitWaggleTurnEvent).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({ type: 'collaboration-pending' }),
    )
    expect(activeRuns.has(SESSION_ID)).toBe(false)
    expect(activeWaggleRuns.has(SESSION_ID)).toBe(false)
    expect(mocks.emitRunCompleted).toHaveBeenCalledOnce()
  })

  it('refuses standard and compaction starts while session removal owns admission', async () => {
    const { compact, send } = registerHandlers()
    const release = acquireSessionRemovalFence(SESSION_ID)

    try {
      await expect(Effect.runPromise(send({}, SESSION_ID, PAYLOAD, MODEL))).rejects.toThrow(
        'being archived or deleted',
      )
      await expect(Effect.runPromise(compact({}, SESSION_ID, MODEL))).rejects.toThrow(
        'being archived or deleted',
      )
      expect(mocks.executeAgentRun).not.toHaveBeenCalled()
      expect(mocks.compactAgentSession).not.toHaveBeenCalled()
    } finally {
      release()
    }
  })

  it('refuses a handoff start that races with session removal', async () => {
    const standardRun = Promise.withResolvers<{
      readonly outcome: 'success'
      readonly newMessages: readonly Message[]
    }>()
    mocks.executeAgentRun.mockReturnValue(Effect.promise(() => standardRun.promise))
    const { send } = registerHandlers()
    const run = Effect.runPromise(send({}, SESSION_ID, PAYLOAD, MODEL))
    await vi.waitFor(() => expect(activeRuns.has(SESSION_ID)).toBe(true))
    const release = acquireSessionRemovalFence(SESSION_ID)

    try {
      standardRun.resolve({ outcome: 'success', newMessages: [handoffMessage()] })
      await expect(run).rejects.toThrow('being archived or deleted')
      expect(mocks.executeWaggleRun).not.toHaveBeenCalled()
      expect(activeWaggleRuns.has(SESSION_ID)).toBe(false)
    } finally {
      release()
    }
  })

  it('does not chain aborted or malformed standard outcomes', async () => {
    const { send } = registerHandlers()
    mocks.executeAgentRun.mockReturnValueOnce(Effect.succeed({ outcome: 'aborted' }))
    await Effect.runPromise(send({}, SESSION_ID, PAYLOAD, MODEL))

    mocks.executeAgentRun.mockReturnValueOnce(
      Effect.succeed({
        outcome: 'success',
        newMessages: [{ ...handoffMessage(), parts: [] }],
      }),
    )
    await Effect.runPromise(send({}, SESSION_ID, PAYLOAD, MODEL))

    expect(mocks.executeWaggleRun).not.toHaveBeenCalled()
    expect(activeRuns.has(SESSION_ID)).toBe(false)
  })

  it('captures persisted resources from a terminally failed standard run', async () => {
    const resourceMessages = [
      {
        id: MessageId('failed-run-resource-message'),
        role: 'assistant' as const,
        createdAt: 2,
        parts: [{ type: 'text' as const, text: '[Partial docs](https://example.test/docs)' }],
      },
    ]
    mocks.executeAgentRun.mockReturnValue(
      Effect.succeed({
        outcome: 'error',
        message: 'Provider stopped after partial output',
        code: 'provider-error',
        transportEmitted: true,
        resourceMessages,
        resourceNodeIds: { 'failed-run-resource-message': 'persisted-resource-node' },
        resourceBranchIds: { 'failed-run-resource-message': 'agent-handoff-session:main' },
      }),
    )
    const { send } = registerHandlers()

    await Effect.runPromise(send({}, SESSION_ID, PAYLOAD, MODEL))

    expect(mocks.captureSuccessfulRunResources).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      runId: expect.any(String),
      payload: PAYLOAD,
      messages: resourceMessages,
      nodeIdByMessageId: { 'failed-run-resource-message': 'persisted-resource-node' },
      branchIdByMessageId: { 'failed-run-resource-message': 'agent-handoff-session:main' },
    })
    expect(mocks.executeWaggleRun).not.toHaveBeenCalled()
  })

  it('captures persisted resources from a partially aborted standard run', async () => {
    const resourceMessages = [
      {
        id: MessageId('aborted-run-resource-message'),
        role: 'assistant' as const,
        createdAt: 2,
        parts: [{ type: 'text' as const, text: '[Partial docs](https://example.test/docs)' }],
      },
    ]
    mocks.executeAgentRun.mockReturnValue(
      Effect.succeed({
        outcome: 'aborted',
        resourceMessages,
        resourceNodeIds: { 'aborted-run-resource-message': 'persisted-resource-node' },
        resourceBranchIds: { 'aborted-run-resource-message': 'agent-handoff-session:main' },
      }),
    )
    const { send } = registerHandlers()

    await Effect.runPromise(send({}, SESSION_ID, PAYLOAD, MODEL))

    expect(mocks.captureSuccessfulRunResources).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      runId: expect.any(String),
      payload: PAYLOAD,
      messages: resourceMessages,
      nodeIdByMessageId: { 'aborted-run-resource-message': 'persisted-resource-node' },
      branchIdByMessageId: { 'aborted-run-resource-message': 'agent-handoff-session:main' },
    })
    expect(mocks.executeWaggleRun).not.toHaveBeenCalled()
  })

  it('surfaces Waggle validation failures and still completes cleanup', async () => {
    mocks.executeAgentRun.mockReturnValue(
      Effect.succeed({ outcome: 'success', newMessages: [handoffMessage()] }),
    )
    mocks.executeWaggleRun.mockReturnValue(
      Effect.succeed({ outcome: 'validation-error', message: 'Invalid preset', code: 'invalid' }),
    )
    const { send } = registerHandlers()

    await Effect.runPromise(send({}, SESSION_ID, PAYLOAD, MODEL))

    expect(mocks.emitErrorAndFinish).toHaveBeenCalledWith(
      SESSION_ID,
      'Invalid preset',
      'invalid',
      `waggle-${SESSION_ID}`,
    )
    expect(activeRuns.has(SESSION_ID)).toBe(false)
    expect(activeWaggleRuns.has(SESSION_ID)).toBe(false)
    expect(mocks.emitRunCompleted).toHaveBeenCalledOnce()
  })

  it('surfaces thrown Waggle failures and still completes cleanup', async () => {
    mocks.executeAgentRun.mockReturnValue(
      Effect.succeed({ outcome: 'success', newMessages: [handoffMessage()] }),
    )
    mocks.executeWaggleRun.mockReturnValue(Effect.fail(new Error('repository failed')))
    const { send } = registerHandlers()

    await expect(Effect.runPromise(send({}, SESSION_ID, PAYLOAD, MODEL))).rejects.toThrow(
      'repository failed',
    )

    expect(mocks.emitErrorAndFinish).toHaveBeenCalledWith(
      SESSION_ID,
      'Something went wrong',
      'unknown',
      `waggle-${SESSION_ID}`,
    )
    expect(activeWaggleRuns.has(SESSION_ID)).toBe(false)
    expect(activeRuns.has(SESSION_ID)).toBe(false)
    expect(mocks.clearAgentPhase).toHaveBeenCalledWith(SESSION_ID)
    expect(mocks.clearStreamBuffer).toHaveBeenCalledWith(SESSION_ID)
    expect(mocks.emitRunCompleted).toHaveBeenCalledWith(SESSION_ID)
  })

  it('cancels during handoff and clears classic and Waggle run state', async () => {
    mocks.executeAgentRun.mockReturnValue(
      Effect.succeed({ outcome: 'success', newMessages: [handoffMessage()] }),
    )
    mocks.executeWaggleRun.mockImplementation((input) =>
      Effect.async((resume) => {
        input.onRunPrepared(MODEL)
        input.signal.addEventListener(
          'abort',
          () => resume(Effect.succeed({ outcome: 'aborted' })),
          { once: true },
        )
      }),
    )
    const { cancel, send } = registerHandlers()
    const run = Effect.runPromise(send({}, SESSION_ID, PAYLOAD, MODEL))
    await vi.waitFor(() => expect(mocks.executeWaggleRun).toHaveBeenCalledOnce())

    await Effect.runPromise(cancel({}, SESSION_ID))
    await run

    expect(activeRuns.has(SESSION_ID)).toBe(false)
    expect(activeWaggleRuns.has(SESSION_ID)).toBe(false)
    expect(mocks.emitTransportEvent).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({ type: 'agent_end', reason: 'aborted' }),
    )
    expect(mocks.emitRunCompleted).toHaveBeenCalledOnce()
  })
})
