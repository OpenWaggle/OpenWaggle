import { BUILT_IN_WAGGLE_PRESETS } from '@openwaggle/waggle-core'
import type { AgentSteerDeliveryResult, Message } from '@shared/types/agent'
import { MessageId, SessionId, SupportedModelId, ToolCallId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toJsonValue } from '../../adapters/pi/pi-message-mapper'

const mocks = vi.hoisted(() => ({
  clearAgentPhase: vi.fn(),
  clearStreamBuffer: vi.fn(),
  compactAgentSession: vi.fn(),
  emitErrorAndFinish: vi.fn(),
  emitRunCompleted: vi.fn(),
  emitTransportEvent: vi.fn(),
  emitWaggleTransportEvent: vi.fn(),
  emitWaggleTurnEvent: vi.fn(),
  executeAgentRun: vi.fn(),
  executeWaggleRun: vi.fn(),
  getAgentContextUsage: vi.fn(),
  hydrateAgentRunPayload: vi.fn(),
  startStreamBuffer: vi.fn(),
  typedHandle: vi.fn(),
}))

vi.mock('../typed-ipc', () => ({ typedHandle: mocks.typedHandle }))
vi.mock('../../agent/session-cleanup', () => ({ cleanupSessionRun: vi.fn() }))
vi.mock('../../application/agent-run-service', () => ({ executeAgentRun: mocks.executeAgentRun }))
vi.mock('../../application/agent-run/kernel', () => ({
  hydrateAgentRunPayload: mocks.hydrateAgentRunPayload,
}))
vi.mock('../../application/agent-session-service', () => ({
  compactAgentSession: mocks.compactAgentSession,
  getAgentContextUsage: mocks.getAgentContextUsage,
}))
vi.mock('../../application/waggle-run-service', () => ({
  executeWaggleRun: mocks.executeWaggleRun,
}))
vi.mock('../../utils/broadcast', () => ({ broadcastToWindows: vi.fn() }))
vi.mock('../../utils/stream-bridge', () => ({
  clearAgentPhase: mocks.clearAgentPhase,
  clearStreamBuffer: mocks.clearStreamBuffer,
  emitRunCompleted: mocks.emitRunCompleted,
  emitTransportEvent: mocks.emitTransportEvent,
  emitWaggleTransportEvent: mocks.emitWaggleTransportEvent,
  emitWaggleTurnEvent: mocks.emitWaggleTurnEvent,
  getStreamBuffer: vi.fn(),
  listStreamBuffers: vi.fn(() => []),
  startStreamBuffer: mocks.startStreamBuffer,
}))
vi.mock('../run-handler-utils', () => ({ emitErrorAndFinish: mocks.emitErrorAndFinish }))

import { activeRuns, activeWaggleRuns, cancelAllSessionRuns } from '../active-agent-runs'
import { registerAgentHandlers } from '../agent-handler'

const SESSION_ID = SessionId('agent-handoff-session')
const MODEL = SupportedModelId('openai/gpt-5.4')
const PAYLOAD = { text: 'Review this', thinkingLevel: 'medium', attachments: [] } as const
const STEER_DELIVERY = { delivery: 'queued', durableText: PAYLOAD.text } as const
const STEER_RESULT = { preserved: true, delivery: STEER_DELIVERY } as const

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

function registeredHandler(channel: string) {
  const handler = mocks.typedHandle.mock.calls.find((call) => call[0] === channel)?.[1]
  if (typeof handler !== 'function') throw new Error(`Expected ${channel} handler`)
  return handler
}

function registerHandlers() {
  registerAgentHandlers()
  return {
    cancel: registeredHandler('agent:cancel'),
    send: registeredHandler('agent:send-message'),
    steer: registeredHandler('agent:steer'),
  }
}

function installPendingAgentRun(nativeSteer: () => Promise<AgentSteerDeliveryResult>) {
  mocks.executeAgentRun.mockImplementation((input) =>
    Effect.async((resume) => {
      input.onControlAvailable?.({ steer: nativeSteer })
      input.signal.addEventListener('abort', () => resume(Effect.succeed({ outcome: 'aborted' })), {
        once: true,
      })
    }),
  )
}

describe('agent handler Waggle handoff lifecycle', () => {
  beforeEach(() => {
    cancelAllSessionRuns()
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.compactAgentSession.mockReturnValue(Effect.void)
    mocks.getAgentContextUsage.mockReturnValue(Effect.succeed(null))
    mocks.hydrateAgentRunPayload.mockImplementation((payload) => Effect.succeed(payload))
  })

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

  it('delivers steering through the active run control without cancelling the run', async () => {
    const nativeSteer = vi.fn(async () => STEER_DELIVERY)
    installPendingAgentRun(nativeSteer)
    const { cancel, send, steer } = registerHandlers()
    const run = Effect.runPromise(send({}, SESSION_ID, PAYLOAD, MODEL))
    await vi.waitFor(() => expect(mocks.executeAgentRun).toHaveBeenCalledOnce())

    expect(await Effect.runPromise(steer({}, SESSION_ID, PAYLOAD))).toEqual(STEER_RESULT)
    expect(nativeSteer).toHaveBeenCalledWith(PAYLOAD)
    expect(activeRuns.has(SESSION_ID)).toBe(true)
    expect(mocks.emitRunCompleted).not.toHaveBeenCalled()

    await Effect.runPromise(cancel({}, SESSION_ID))
    await run
  })

  it('routes steering to the Waggle control after a classic handoff', async () => {
    const classicSteer = vi.fn(async () => STEER_DELIVERY)
    const waggleSteer = vi.fn(async () => STEER_DELIVERY)
    mocks.executeAgentRun.mockImplementation((input) =>
      Effect.sync(() => {
        input.onControlAvailable?.({ steer: classicSteer })
        return { outcome: 'success', newMessages: [handoffMessage()] }
      }),
    )
    mocks.executeWaggleRun.mockImplementation((input) =>
      Effect.async((resume) => {
        input.onControlAvailable?.({ steer: waggleSteer })
        input.signal.addEventListener(
          'abort',
          () => resume(Effect.succeed({ outcome: 'aborted' })),
          { once: true },
        )
      }),
    )
    const { cancel, send, steer } = registerHandlers()
    const run = Effect.runPromise(send({}, SESSION_ID, PAYLOAD, MODEL))
    await vi.waitFor(() => expect(mocks.executeWaggleRun).toHaveBeenCalledOnce())

    await Effect.runPromise(steer({}, SESSION_ID, PAYLOAD))

    expect(waggleSteer).toHaveBeenCalledWith(PAYLOAD)
    expect(classicSteer).not.toHaveBeenCalled()
    await Effect.runPromise(cancel({}, SESSION_ID))
    await run
  })

  it('does not deliver through a stale control when the run ends during hydration', async () => {
    const nativeSteer = vi.fn(async () => STEER_DELIVERY)
    let releaseHydration!: () => void
    const hydrationGate = new Promise<void>((resolve) => {
      releaseHydration = resolve
    })
    mocks.hydrateAgentRunPayload.mockImplementation((payload) =>
      Effect.promise(async () => {
        await hydrationGate
        return payload
      }),
    )
    installPendingAgentRun(nativeSteer)
    const { cancel, send, steer } = registerHandlers()
    const run = Effect.runPromise(send({}, SESSION_ID, PAYLOAD, MODEL))
    await vi.waitFor(() => expect(mocks.executeAgentRun).toHaveBeenCalledOnce())
    const pendingSteer = Effect.runPromise(steer({}, SESSION_ID, PAYLOAD))
    await vi.waitFor(() => expect(mocks.hydrateAgentRunPayload).toHaveBeenCalledOnce())

    await Effect.runPromise(cancel({}, SESSION_ID))
    releaseHydration()

    await expect(pendingSteer).rejects.toThrow('ended before steering was delivered')
    expect(nativeSteer).not.toHaveBeenCalled()
    await run
  })

  it('delivers through a directly registered Waggle run control', async () => {
    const nativeSteer = vi.fn(async () => STEER_DELIVERY)
    const abortController = new AbortController()
    activeWaggleRuns.register(SESSION_ID, abortController, {
      controlRef: { current: { steer: nativeSteer } },
      steerTailRef: { current: Promise.resolve() },
    })
    const { steer } = registerHandlers()

    expect(await Effect.runPromise(steer({}, SESSION_ID, PAYLOAD))).toEqual(STEER_RESULT)
    expect(nativeSteer).toHaveBeenCalledWith(PAYLOAD)
    activeWaggleRuns.cancel(SESSION_ID)
  })
})
