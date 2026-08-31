import { LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION } from '@shared/types/local-session-profile-management'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import {
  installLocalSessionProfileAdmissionFencer,
  installLocalSessionProfileAdmissionRefresher,
} from '../../session-host/local-session-profile-invalidation'
import { manageLocalSessionProfiles } from '../local-session-profile-management'
import {
  localSessionProfileManagementTestLayer,
  PROJECT_PATH,
  profileManagementRequest,
} from './local-session-profile-management.test-support'

const PROFILE = {
  id: 'worker-id',
  name: 'worker',
  capabilities: ['sessions:read'] as const,
  scope: { projectPaths: [PROJECT_PATH] },
  authorizationCeiling: 'ask-for-approval' as const,
  revokedAt: null,
  lastAuthenticatedAt: null,
  createdAt: 1,
  updatedAt: 2,
}

function updateRequest() {
  return profileManagementRequest({
    operation: 'update',
    profileName: 'worker',
    capabilities: ['sessions:read'],
    scope: { projectPaths: [PROJECT_PATH] },
    authorizationCeiling: 'ask-for-approval',
  })
}

describe('Local Session profile management fencing', () => {
  it('fences an update before persistence and refreshes authority before returning', async () => {
    const order: string[] = []
    const releaseFencer = installLocalSessionProfileAdmissionFencer(async (name) => {
      order.push(`fence:${name}`)
    })
    const releaseRefresher = installLocalSessionProfileAdmissionRefresher(async (profileId) => {
      order.push(`refresh:${profileId ?? 'all'}`)
    })
    try {
      await Effect.runPromise(
        manageLocalSessionProfiles({
          caller: { callerId: 'local-user' },
          request: updateRequest(),
          now: 2,
        }).pipe(
          Effect.provide(
            localSessionProfileManagementTestLayer(async (input) => {
              order.push('persist')
              return {
                contractVersion: LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION,
                requestId: input.request.requestId,
                idempotencyKey: input.request.idempotencyKey,
                replayed: false,
                outcome: { operation: 'update', effect: 'profile-updated', profile: PROFILE },
              }
            }),
          ),
        ),
      )
    } finally {
      releaseFencer()
      releaseRefresher()
    }

    expect(order).toEqual(['fence:worker', 'persist', 'refresh:worker-id'])
  })

  it('serializes concurrent updates across fence, persistence, and authority refresh', async () => {
    const order: string[] = []
    let fenceDepth = 0
    let releaseFirstPersist!: () => void
    let releaseSecondPersist!: () => void
    const firstPersistGate = new Promise<void>((resolve) => {
      releaseFirstPersist = resolve
    })
    const secondPersistGate = new Promise<void>((resolve) => {
      releaseSecondPersist = resolve
    })
    const releaseFencer = installLocalSessionProfileAdmissionFencer(async () => {
      fenceDepth += 1
      order.push(`fence:${fenceDepth}`)
    })
    const releaseRefresher = installLocalSessionProfileAdmissionRefresher(
      async (_profileId, options) => {
        expect(options?.consumeExistingFence).toBe(true)
        order.push(`refresh:${fenceDepth}`)
        fenceDepth -= 1
      },
    )
    let persistenceCall = 0
    const layer = localSessionProfileManagementTestLayer(async (input) => {
      persistenceCall += 1
      const call = persistenceCall
      order.push(`persist-${call}:start`)
      await (call === 1 ? firstPersistGate : secondPersistGate)
      order.push(`persist-${call}:end`)
      return {
        contractVersion: LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION,
        requestId: input.request.requestId,
        idempotencyKey: input.request.idempotencyKey,
        replayed: false,
        outcome: {
          operation: 'update',
          effect: 'profile-updated',
          profile: PROFILE,
        },
      }
    })
    const run = (now: number) =>
      Effect.runPromise(
        manageLocalSessionProfiles({
          caller: { callerId: 'local-user' },
          request: updateRequest(),
          now,
        }).pipe(Effect.provide(layer)),
      )

    try {
      const first = run(2)
      await vi.waitFor(() => expect(order).toContain('persist-1:start'))
      const second = run(3)
      await Promise.resolve()
      expect(order).not.toContain('persist-2:start')

      releaseFirstPersist()
      await vi.waitFor(() => expect(order).toContain('persist-2:start'))
      expect(fenceDepth).toBe(1)
      expect(order.slice(-2)).toEqual(['fence:1', 'persist-2:start'])

      releaseSecondPersist()
      await Promise.all([first, second])
    } finally {
      releaseFirstPersist()
      releaseSecondPersist()
      releaseFencer()
      releaseRefresher()
    }

    expect(fenceDepth).toBe(0)
    expect(order).toEqual([
      'fence:1',
      'persist-1:start',
      'persist-1:end',
      'refresh:1',
      'fence:1',
      'persist-2:start',
      'persist-2:end',
      'refresh:1',
    ])
  })

  it('keeps a revoked profile fenced while live runs are interrupted', async () => {
    const order: string[] = []
    const releaseFencer = installLocalSessionProfileAdmissionFencer(async (name) => {
      order.push(`fence:${name}`)
    })
    try {
      await Effect.runPromise(
        manageLocalSessionProfiles({
          caller: { callerId: 'local-user' },
          request: profileManagementRequest({ operation: 'revoke', profileName: 'worker' }),
          now: 2,
        }).pipe(
          Effect.provide(
            localSessionProfileManagementTestLayer(
              async (input) => {
                order.push('persist')
                return {
                  contractVersion: LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION,
                  requestId: input.request.requestId,
                  idempotencyKey: input.request.idempotencyKey,
                  replayed: false,
                  outcome: {
                    operation: 'revoke',
                    effect: 'profile-revoked',
                    profile: { ...PROFILE, revokedAt: 2 },
                    interruptedRuns: [{ sessionId: 'worker-session', runId: 'run-worker' }],
                  },
                }
              },
              () =>
                Effect.sync(() => {
                  order.push('interrupt')
                  return { accepted: true } as const
                }),
            ),
          ),
        ),
      )
    } finally {
      releaseFencer()
    }

    expect(order).toEqual(['fence:worker', 'persist', 'interrupt'])
  })
})
