import { SessionId } from '@shared/types/brand'
import {
  SESSION_LIFECYCLE_CONTRACT_VERSION,
  type SessionLifecycleRequest,
  type SessionLifecycleResponse,
} from '@shared/types/session-lifecycle'
import { fromAny, fromPartial } from '@total-typescript/shoehorn'
import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

const { generateMock } = vi.hoisted(() => ({ generateMock: vi.fn() }))

vi.mock('../session-title-service', () => ({
  generateInitialSessionTitle: (input: unknown) => Effect.sync(() => generateMock(input)),
  regenerateSessionTitle: () => Effect.succeed({ outcome: 'superseded' }),
}))
vi.mock('../session-title-refinement', () => ({ refineSessionTitle: () => Effect.void }))
vi.mock('../session-title-recovery', () => ({ recoverSessionTitleWork: Effect.void }))

const scheduler = await import('../session-title-scheduler')

function spawnRequest(): SessionLifecycleRequest {
  return fromPartial({
    contractVersion: SESSION_LIFECYCLE_CONTRACT_VERSION,
    requestId: 'request',
    idempotencyKey: 'key',
    command: { operation: 'spawn', delegation: { objective: 'Review the auth module' } },
  })
}

function spawned(replayed = false): SessionLifecycleResponse {
  return fromPartial({
    replayed,
    outcome: { operation: 'spawn', effect: 'spawned-worker', sessionId: 'worker-1' },
  })
}

/** The scheduler only captures the runtime; the mocked work needs none of its services. */
function installHostRuntime() {
  return Effect.runPromise(
    fromAny<Effect.Effect<void>, typeof scheduler.installSessionTitleWorker>(
      scheduler.installSessionTitleWorker,
    ),
  )
}

describe('session title scheduler', () => {
  it('does nothing outside the Session Host and answers regeneration with a failure', async () => {
    scheduler.requestLifecycleTitle(spawnRequest(), spawned())

    expect(generateMock).not.toHaveBeenCalled()
    await expect(scheduler.runSessionTitleRegeneration(SessionId('s'))).resolves.toMatchObject({
      outcome: 'failed',
    })
  })

  it('titles a freshly spawned Worker from its objective, and only that', async () => {
    await installHostRuntime()

    scheduler.requestLifecycleTitle(spawnRequest(), spawned(true))
    scheduler.requestLifecycleTitle(
      spawnRequest(),
      fromPartial({ replayed: false, outcome: { effect: 'launched-root', sessionId: 'root' } }),
    )
    scheduler.requestLifecycleTitle(spawnRequest(), spawned())
    await vi.waitFor(() => expect(generateMock).toHaveBeenCalledTimes(1))

    expect(generateMock).toHaveBeenCalledWith({
      sessionId: 'worker-1',
      text: 'Review the auth module',
      settleOnFailure: false,
    })
  })

  it('titles an untitled launched root from its objective, but never one launched with a title', async () => {
    await installHostRuntime()
    generateMock.mockClear()
    const launch = (title?: string): SessionLifecycleRequest =>
      fromPartial({
        command: {
          operation: 'launch',
          objective: 'Audit the schema',
          ...(title === undefined ? {} : { title }),
        },
      })
    const launched: SessionLifecycleResponse = fromPartial({
      replayed: false,
      outcome: { operation: 'launch', effect: 'launched-root', sessionId: 'root-1' },
    })

    scheduler.requestLifecycleTitle(launch('Named by caller'), launched)
    // An attachment's name only reaches the title prompt through the first Run.
    scheduler.requestLifecycleTitle(
      fromPartial({
        command: { operation: 'launch', objective: 'What is this?', attachmentIds: ['a1'] },
      }),
      launched,
    )
    scheduler.requestLifecycleTitle(launch(), launched)
    await vi.waitFor(() => expect(generateMock).toHaveBeenCalledTimes(1))

    expect(generateMock).toHaveBeenCalledWith({
      sessionId: 'root-1',
      text: 'Audit the schema',
      settleOnFailure: false,
    })
  })
})
