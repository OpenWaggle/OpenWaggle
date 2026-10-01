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

describe('session title scheduler', () => {
  it('does nothing outside the Session Host and answers regeneration with a failure', async () => {
    scheduler.requestSpawnedWorkerTitle(spawnRequest(), spawned())

    expect(generateMock).not.toHaveBeenCalled()
    await expect(scheduler.runSessionTitleRegeneration(SessionId('s'))).resolves.toMatchObject({
      outcome: 'failed',
    })
  })

  it('titles a freshly spawned Worker from its objective, and only that', async () => {
    // The scheduler only captures the runtime; the mocked work needs none of its services.
    await Effect.runPromise(
      fromAny<Effect.Effect<void>, typeof scheduler.installSessionTitleWorker>(
        scheduler.installSessionTitleWorker,
      ),
    )

    scheduler.requestSpawnedWorkerTitle(spawnRequest(), spawned(true))
    scheduler.requestSpawnedWorkerTitle(
      spawnRequest(),
      fromPartial({ replayed: false, outcome: { effect: 'launched-root', sessionId: 'root' } }),
    )
    scheduler.requestSpawnedWorkerTitle(spawnRequest(), spawned())
    await vi.waitFor(() => expect(generateMock).toHaveBeenCalledTimes(1))

    expect(generateMock).toHaveBeenCalledWith({
      sessionId: 'worker-1',
      text: 'Review the auth module',
    })
  })
})
