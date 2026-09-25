import os from 'node:os'
import type { Message } from '@shared/types/agent'
import { MessageId, SessionId, SupportedModelId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'

const { loggerErrorMock } = vi.hoisted(() => ({
  loggerErrorMock: vi.fn(),
}))

vi.mock('../../logger', () => ({
  createLogger: () => ({
    error: loggerErrorMock,
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}))

const { buildAgentRunOutcome, recoverAgentRunFailure } = await import('../agent-run/outcome')
const { SessionProjectionRepositoryError } = await import('../../errors')

const context = {
  sessionId: SessionId('session-1'),
  runId: 'run-1',
  model: SupportedModelId('anthropic/claude-sonnet-4-5'),
  signal: new AbortController().signal,
}

function assistantMessage(): Message {
  return {
    id: MessageId('message-1'),
    role: 'assistant',
    createdAt: 1,
    parts: [{ type: 'text', text: 'Done' }],
  }
}

describe('buildAgentRunOutcome', () => {
  it('returns success with new messages and assigned title', () => {
    const messages = [assistantMessage()]
    const result = buildAgentRunOutcome({
      ...context,
      assignedTitle: 'New title',
      signal: new AbortController().signal,
      agentResult: { newMessages: messages },
    })

    expect(result).toEqual({
      outcome: 'success',
      newMessages: messages,
      resourceMessages: messages,
      resourceNodeIds: { 'message-1': 'message-1' },
      resourceBranchIds: {},
      assignedTitle: 'New title',
    })
  })

  it('keeps persisted resource projection on an aborted outcome', () => {
    const controller = new AbortController()
    controller.abort()
    const messages = [assistantMessage()]

    expect(
      buildAgentRunOutcome({
        ...context,
        assignedTitle: 'Kept title',
        signal: controller.signal,
        agentResult: { newMessages: messages },
      }),
    ).toEqual({
      outcome: 'aborted',
      resourceMessages: messages,
      resourceNodeIds: { 'message-1': 'message-1' },
      resourceBranchIds: {},
      assignedTitle: 'Kept title',
    })
  })

  it('keeps a stopped retry aborted when Pi retains its earlier terminal error', () => {
    const controller = new AbortController()
    controller.abort()

    expect(
      buildAgentRunOutcome({
        ...context,
        signal: controller.signal,
        agentResult: {
          aborted: true,
          terminalError: 'terminated',
          newMessages: [assistantMessage()],
        },
      }),
    ).toMatchObject({ outcome: 'aborted' })
  })

  it('treats an empty projection as an aborted outcome without resource work', () => {
    expect(
      buildAgentRunOutcome({
        ...context,
        signal: new AbortController().signal,
        agentResult: { newMessages: [] },
      }),
    ).toEqual({ outcome: 'aborted' })
  })

  it('maps terminal transport errors while retaining persisted resource projection', () => {
    const messages = [assistantMessage()]
    const result = buildAgentRunOutcome({
      ...context,
      assignedTitle: 'Failure title',
      signal: new AbortController().signal,
      agentResult: {
        terminalError: 'Model is not authenticated',
        newMessages: messages,
      },
    })

    expect(result).toEqual(
      expect.objectContaining({
        outcome: 'error',
        assignedTitle: 'Failure title',
        transportEmitted: true,
        resourceMessages: messages,
        resourceNodeIds: { 'message-1': 'message-1' },
        resourceBranchIds: {},
      }),
    )
  })
})

describe('recoverAgentRunFailure', () => {
  it('keeps explicit aborted errors as aborted outcomes', async () => {
    await expect(
      Effect.runPromise(
        recoverAgentRunFailure({
          ...context,
          assignedTitle: 'Abort title',
          error: new Error('aborted'),
        }),
      ),
    ).resolves.toEqual({ outcome: 'aborted', assignedTitle: 'Abort title' })
  })

  it('classifies unknown failures as user-facing error outcomes', async () => {
    const result = await Effect.runPromise(
      recoverAgentRunFailure({ ...context, error: new Error('network unavailable') }),
    )

    expect(result).toEqual(
      expect.objectContaining({
        outcome: 'error',
        code: expect.any(String),
        message: expect.any(String),
      }),
    )
  })

  /*
   * ADR 0037. A tagged repository error has an empty `message`, so this used to report the unknown
   * code, send "Something went wrong" as the detail, and log `error: ""`.
   */
  it('reports a repository failure after the agent answered as a turn that could not be saved', async () => {
    loggerErrorMock.mockClear()
    const error = new SessionProjectionRepositoryError({
      operation: 'persistSessionSnapshot',
      cause: new Error('CHECK constraint failed: token_count >= 0'),
    })

    const result = await Effect.runPromise(
      recoverAgentRunFailure({ ...context, error, reachedAgent: true }),
    )

    expect(result).toEqual(
      expect.objectContaining({
        outcome: 'error',
        code: 'persist-failed',
        message:
          'SessionProjectionRepositoryError (persistSessionSnapshot) <- Error: CHECK constraint failed: token_count >= 0',
        transportEmitted: true,
      }),
    )
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Agent run failed before terminal transport event',
      expect.objectContaining({
        error: expect.stringContaining('CHECK constraint failed'),
      }),
    )
  })

  it('classifies a provider termination exactly, as before tagged-error handling', async () => {
    const result = await Effect.runPromise(
      recoverAgentRunFailure({ ...context, error: new Error('terminated'), reachedAgent: true }),
    )

    expect(result).toMatchObject({ outcome: 'error', code: 'provider-unavailable' })
  })

  it('does not report a turn as unsaved when a later projection write fails', async () => {
    // The snapshot committed; only anchoring the turn checkpoint failed afterwards.
    const error = new SessionProjectionRepositoryError({ operation: 'setTurnCheckpointAnchor' })

    const result = await Effect.runPromise(
      recoverAgentRunFailure({ ...context, error, reachedAgent: true }),
    )

    expect(result).toMatchObject({ outcome: 'error', code: 'unknown' })
  })

  it('redacts credentials and abbreviates the home directory in published detail', async () => {
    loggerErrorMock.mockClear()
    const home = os.homedir()
    const error = new Error(`request to ${home}/project failed: Bearer abcdef0123456789secret`)

    const result = await Effect.runPromise(recoverAgentRunFailure({ ...context, error }))

    expect(result).toMatchObject({ outcome: 'error' })
    if (result.outcome !== 'error') throw new Error('Expected an error outcome')
    expect(result.message).not.toContain('abcdef0123456789secret')
    expect(result.message).not.toContain(home)
    expect(result.message).toContain('~/project')
    // The Host log keeps the full detail for diagnosis.
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Agent run failed before terminal transport event',
      expect.objectContaining({ error: expect.stringContaining('abcdef0123456789secret') }),
    )
  })

  it('keeps the detail of a failure raised before the agent saw the message', async () => {
    const error = new SessionProjectionRepositoryError({ operation: 'getSessionDetail' })

    const result = await Effect.runPromise(recoverAgentRunFailure({ ...context, error }))

    expect(result).toEqual(
      expect.objectContaining({
        outcome: 'error',
        code: 'unknown',
        message: 'SessionProjectionRepositoryError (getSessionDetail)',
      }),
    )
  })
})
