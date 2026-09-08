import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { activeRuns, activeWaggleRuns } from '../active-agent-runs'
import {
  handoffMessage,
  installPendingAgentRun,
  MODEL,
  mocks,
  PAYLOAD,
  registerHandlers,
  resetAgentHandlerMocks,
  SESSION_ID,
  STEER_DELIVERY,
  STEER_RESULT,
} from './agent-handler-waggle-handoff.test-harness'

describe('agent handler steering lifecycle', () => {
  beforeEach(resetAgentHandlerMocks)

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
