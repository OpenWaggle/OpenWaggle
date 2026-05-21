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

const context = {
  sessionId: SessionId('session-1'),
  runId: 'run-1',
  model: SupportedModelId('anthropic/claude-sonnet-4-5'),
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
      assignedTitle: 'New title',
    })
  })

  it('treats aborted signals and empty projections as aborted outcomes', () => {
    const controller = new AbortController()
    controller.abort()

    expect(
      buildAgentRunOutcome({
        ...context,
        assignedTitle: 'Kept title',
        signal: controller.signal,
        agentResult: { newMessages: [assistantMessage()] },
      }),
    ).toEqual({ outcome: 'aborted', assignedTitle: 'Kept title' })

    expect(
      buildAgentRunOutcome({
        ...context,
        signal: new AbortController().signal,
        agentResult: { newMessages: [] },
      }),
    ).toEqual({ outcome: 'aborted' })
  })

  it('maps terminal transport errors to error outcomes', () => {
    const result = buildAgentRunOutcome({
      ...context,
      assignedTitle: 'Failure title',
      signal: new AbortController().signal,
      agentResult: {
        terminalError: 'Model is not authenticated',
        newMessages: [assistantMessage()],
      },
    })

    expect(result).toEqual(
      expect.objectContaining({
        outcome: 'error',
        assignedTitle: 'Failure title',
        transportEmitted: true,
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
})
