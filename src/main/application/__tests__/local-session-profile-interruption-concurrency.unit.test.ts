import { LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION } from '@shared/types/local-session-profile-management'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import { manageLocalSessionProfiles } from '../local-session-profile-management'
import {
  localSessionProfileManagementTestLayer,
  PROJECT_PATH,
  profileManagementRequest,
} from './local-session-profile-management.test-support'

const INTERRUPTED_RUN_COUNT = 24

describe('Local Session profile interruption concurrency', () => {
  it('bounds profile-revocation Run interruption fan-out', async () => {
    const interruptedRuns = Array.from({ length: INTERRUPTED_RUN_COUNT }, (_, index) => ({
      sessionId: `session-${String(index)}`,
      runId: `run-${String(index)}`,
    }))
    let active = 0
    let maximumActive = 0
    let interruptionCount = 0
    const interrupt = () =>
      Effect.promise(async () => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await new Promise((resolve) => setTimeout(resolve, 2))
        active -= 1
        interruptionCount += 1
        return { accepted: true as const }
      })
    const executeManagement = vi.fn(async (input) => ({
      contractVersion: LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION,
      requestId: input.request.requestId,
      idempotencyKey: input.request.idempotencyKey,
      replayed: false,
      outcome: {
        operation: 'revoke' as const,
        effect: 'profile-revoked' as const,
        profile: {
          id: 'worker',
          name: 'worker',
          capabilities: ['sessions:read'] as const,
          scope: { projectPaths: [PROJECT_PATH] },
          authorizationCeiling: 'ask-for-approval' as const,
          revokedAt: 2,
          lastAuthenticatedAt: null,
          createdAt: 1,
          updatedAt: 2,
        },
        interruptedRuns,
      },
    }))

    await Effect.runPromise(
      manageLocalSessionProfiles({
        caller: { callerId: 'local-user' },
        request: profileManagementRequest({ operation: 'revoke', profileName: 'worker' }),
        now: 2,
      }).pipe(Effect.provide(localSessionProfileManagementTestLayer(executeManagement, interrupt))),
    )

    expect(interruptionCount).toBe(interruptedRuns.length)
    expect(maximumActive).toBeLessThanOrEqual(8)
    expect(maximumActive).toBeGreaterThan(1)
  })
})
