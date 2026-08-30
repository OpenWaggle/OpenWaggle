import { BUILT_IN_WAGGLE_PRESETS } from '@openwaggle/waggle-core'
import type { Message } from '@shared/types/agent'
import { MessageId, SessionId, SupportedModelId, ToolCallId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelAllSessionRuns, cancelSessionRuns } from '../../application/active-session-runs'
import type { WaggleRunInput, WaggleRunResult } from '../../application/waggle-run-service'
import { toJsonValue } from '../pi/pi-message-mapper'

const mocks = vi.hoisted(() => ({
  publishSessionHostEvent: vi.fn(),
  startStreamBuffer: vi.fn(),
}))

vi.mock('../../session-host/session-host-events', () => ({
  publishSessionHostEvent: mocks.publishSessionHostEvent,
}))
vi.mock('../../utils/stream-bridge', () => ({
  startStreamBuffer: mocks.startStreamBuffer,
}))

import { runRequestedWaggleWith } from '../agent-requested-waggle-adapter'

const SESSION_ID = SessionId('agent-handoff-session')
const MODEL = SupportedModelId('openai/gpt-5.4')

function handoffMessage(): Message {
  const preset = BUILT_IN_WAGGLE_PRESETS[0]
  if (!preset) throw new Error('Expected a built-in Waggle preset')
  return {
    id: MessageId('handoff-message'),
    role: 'assistant',
    createdAt: 1,
    parts: [
      {
        type: 'tool-result',
        toolResult: {
          id: ToolCallId('waggle-invoke-call'),
          name: 'waggle_invoke',
          args: {},
          result: null,
          isError: false,
          duration: 1,
          details: toJsonValue({
            kind: 'waggle-handoff',
            presetId: preset.id,
            presetName: preset.name,
            source: 'agent',
            config: preset.config,
            prompt: 'Review the durable result.',
          }),
        },
      },
    ],
  }
}

function input(messages: readonly Message[] = [handoffMessage()]) {
  return {
    sessionId: SESSION_ID,
    runId: 'classic-run',
    messages,
    model: MODEL,
    thinkingLevel: 'medium' as const,
    controller: new AbortController(),
  }
}

function runner(result: WaggleRunResult = { outcome: 'success', newMessages: [] }) {
  return vi.fn((runInput: WaggleRunInput) => {
    runInput.onRunPrepared?.(MODEL)
    return Effect.succeed(result)
  })
}

describe('agent-requested Waggle adapter', () => {
  beforeEach(() => {
    cancelAllSessionRuns()
    for (const mock of Object.values(mocks)) mock.mockReset()
  })

  it('chains a valid handoff through the injected Waggle runner and cleans its registry', async () => {
    const runWaggle = runner()

    await Effect.runPromise(runRequestedWaggleWith(input(), runWaggle))

    expect(runWaggle).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: SESSION_ID,
        runId: `waggle-${SESSION_ID}`,
        model: MODEL,
        payload: expect.objectContaining({ text: 'Review the durable result.' }),
      }),
    )
    expect(mocks.publishSessionHostEvent).toHaveBeenCalledWith({
      kind: 'session-waggle-turn',
      sessionId: SESSION_ID,
      event: expect.objectContaining({ type: 'collaboration-pending' }),
    })
    expect(mocks.publishSessionHostEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'session-transport',
        event: expect.objectContaining({ type: 'agent_end', reason: 'stop' }),
      }),
    )
    expect(cancelSessionRuns(SESSION_ID)).toBe(false)
  })

  it('ignores absent handoffs and a handoff whose controller is already aborted', async () => {
    const runWaggle = runner()
    expect(await Effect.runPromise(runRequestedWaggleWith(input([]), runWaggle))).toBe(false)

    const abortedInput = input()
    abortedInput.controller.abort()
    expect(await Effect.runPromise(runRequestedWaggleWith(abortedInput, runWaggle))).toBe(false)
    expect(runWaggle).not.toHaveBeenCalled()
  })

  it('publishes a structured terminal error for a refused Waggle run', async () => {
    await Effect.runPromise(
      runRequestedWaggleWith(
        input(),
        runner({ outcome: 'validation-error', message: 'Invalid preset', code: 'invalid' }),
      ),
    )

    expect(mocks.publishSessionHostEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          type: 'agent_end',
          reason: 'error',
          error: { message: 'Invalid preset', code: 'invalid' },
        }),
      }),
    )
    expect(cancelSessionRuns(SESSION_ID)).toBe(false)
  })

  it('publishes an error and cleans its registry when the runner fails', async () => {
    const runWaggle = vi.fn(() => Effect.fail(new Error('repository failed')))

    await expect(Effect.runPromise(runRequestedWaggleWith(input(), runWaggle))).rejects.toThrow(
      'repository failed',
    )

    expect(mocks.publishSessionHostEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ type: 'agent_end', reason: 'error' }),
      }),
    )
    expect(cancelSessionRuns(SESSION_ID)).toBe(false)
  })

  it('aborts through the shared run registry and reports the terminal event', async () => {
    const runWaggle = vi.fn((runInput: WaggleRunInput) =>
      Effect.async<WaggleRunResult>((resume) => {
        runInput.signal.addEventListener(
          'abort',
          () => resume(Effect.succeed({ outcome: 'aborted' })),
          { once: true },
        )
      }),
    )
    const running = Effect.runPromise(runRequestedWaggleWith(input(), runWaggle))
    await vi.waitFor(() => expect(runWaggle).toHaveBeenCalledOnce())

    expect(cancelSessionRuns(SESSION_ID)).toBe(true)
    await running

    expect(mocks.publishSessionHostEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ type: 'agent_end', reason: 'aborted' }),
      }),
    )
    expect(cancelSessionRuns(SESSION_ID)).toBe(false)
  })
})
