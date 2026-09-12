import type {
  LocalSessionCallerIdentity,
  LocalSessionProfileAuthority,
} from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import { LocalSessionProfileRepository } from '../../ports/local-session-profile-repository'
import { SessionAuthorizationTargetRepository } from '../../ports/session-authorization-target-repository'
import { SessionQueryRepository } from '../../ports/session-query-repository'
import { SessionWaitService } from '../../ports/session-wait-service'
import { SettingsService } from '../../services/settings-service'
import { dispatchSessionWaitQuery } from '../local-session-command-dispatcher'

type LiveProfile = {
  capabilities: LocalSessionProfileAuthority['capabilities']
  scope: LocalSessionProfileAuthority['scope']
  authorizationCeiling: LocalSessionProfileAuthority['authorizationCeiling']
  revokedAt: number | null
}

const caller: LocalSessionCallerIdentity = {
  callerId: 'profile:observer',
  profileAuthority: {
    profileId: 'observer',
    profileName: 'observer',
    capabilities: ['sessions:read', 'sessions:export'],
    scope: { sessionIds: ['worker'] },
    authorizationCeiling: 'yolo',
  },
}

function waitPayload(operation: 'wait' | 'exports-wait'): LocalSessionCommandPayload {
  return operation === 'wait'
    ? {
        contract: 'session-query-v2',
        request: {
          contractVersion: 2,
          requestId: 'wait-request',
          query: {
            operation: 'wait',
            targets: [{ sessionId: 'worker', condition: 'idle' }],
            timeoutMs: 1_000,
          },
        },
      }
    : {
        contract: 'session-query-v2',
        request: {
          contractVersion: 2,
          requestId: 'export-wait-request',
          query: {
            operation: 'exports-wait',
            sessionId: 'worker',
            exportOperationId: 'export-1',
            timeoutMs: 1_000,
          },
        },
      }
}

function testLayer(input: {
  readonly liveProfile: LiveProfile
  readonly derivedAuthorities: Array<{
    sessionId: string
    capabilities: LocalSessionProfileAuthority['capabilities']
    authorizationCeiling: LocalSessionProfileAuthority['authorizationCeiling']
  }>
  readonly beforeObservation: () => void
  readonly observeAuthority?: (authority: LocalSessionProfileAuthority | undefined) => void
}) {
  const profileRepository = Layer.succeed(LocalSessionProfileRepository, {
    list: () => Effect.succeed([]),
    findForAuthentication: () => Effect.succeed(null),
    findById: () =>
      Effect.succeed({
        id: 'observer',
        name: 'observer',
        credentialVerifier: 'unused',
        capabilities: input.liveProfile.capabilities,
        scope: input.liveProfile.scope,
        authorizationCeiling: input.liveProfile.authorizationCeiling,
        revokedAt: input.liveProfile.revokedAt,
      }),
    recordAuthentication: () => Effect.void,
    executeManagement: () => Effect.die('Profile management is not used in this test.'),
  })
  const targetRepository = Layer.succeed(SessionAuthorizationTargetRepository, {
    resolve: (sessionId) =>
      Effect.succeed({
        sessionId,
        projectPath: '/project',
        hiveRootSessionId: 'queen',
        authorizationCeiling: 'yolo' as const,
      }),
    resolveDelegation: (delegationId) =>
      Effect.succeed({
        sessionId: delegationId,
        projectPath: '/project',
        hiveRootSessionId: 'queen',
        authorizationCeiling: 'yolo' as const,
      }),
    listLiveDerivedAuthorities: () => Effect.succeed(input.derivedAuthorities),
  })
  const observe = (
    resolveObservationAuthority?: () => Promise<LocalSessionProfileAuthority | undefined>,
  ) =>
    Effect.tryPromise({
      try: async () => {
        input.beforeObservation()
        const authority = await resolveObservationAuthority?.()
        input.observeAuthority?.(authority)
        return {
          contractVersion: 2 as const,
          requestId: 'observed',
          outcome: {
            operation: 'wait' as const,
            timedOut: true,
            matchedSessionIds: [],
            cursor: { hostInstanceId: 'host', sequence: 0 },
            states: [],
          },
        }
      },
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    })
  const waitService = Layer.succeed(
    SessionWaitService,
    SessionWaitService.of({
      wait: (input) => observe(input.resolveObservationAuthority),
      waitForExport: (input) =>
        observe(input.resolveObservationAuthority).pipe(
          Effect.map((response) => ({
            ...response,
            outcome: {
              operation: 'exports-wait' as const,
              error: { code: 'export_not_found' as const, message: 'irrelevant' },
            },
          })),
        ),
    }),
  )
  const settings = Layer.succeed(SettingsService, {
    get: () => Effect.succeed(DEFAULT_SETTINGS),
    update: () => Effect.void,
    initialize: () => Effect.void,
    flushForTests: () => Effect.void,
  })
  const queryRepository = Layer.succeed(SessionQueryRepository, {
    execute: () => Effect.die('Direct Session queries are not used in this test.'),
  })
  return Layer.mergeAll(profileRepository, targetRepository, waitService, settings, queryRepository)
}

function dispatchEffect(
  operation: 'wait' | 'exports-wait',
  input: Parameters<typeof testLayer>[0],
) {
  const payload = waitPayload(operation)
  if (payload.contract !== 'session-query-v2') throw new Error('Expected Session query payload.')
  return dispatchSessionWaitQuery(caller, payload).pipe(Effect.provide(testLayer(input)))
}

describe('Local Session command wait authorization', () => {
  it('rejects a Session wait when its connected profile is revoked before observation', async () => {
    const liveProfile: LiveProfile = {
      capabilities: ['sessions:read'],
      scope: { sessionIds: ['worker'] },
      authorizationCeiling: 'yolo',
      revokedAt: null,
    }

    const error = await Effect.runPromise(
      dispatchEffect('wait', {
        liveProfile,
        derivedAuthorities: [],
        beforeObservation: () => {
          liveProfile.revokedAt = 10
        },
      }).pipe(Effect.flip),
    )

    expect(error).toMatchObject({ code: 'profile_revoked' })
  })

  it('rejects an export wait after the profile loses its export capability', async () => {
    const liveProfile: LiveProfile = {
      capabilities: ['sessions:export'],
      scope: { sessionIds: ['worker'] },
      authorizationCeiling: 'yolo',
      revokedAt: null,
    }

    const error = await Effect.runPromise(
      dispatchEffect('exports-wait', {
        liveProfile,
        derivedAuthorities: [],
        beforeObservation: () => {
          liveProfile.capabilities = []
        },
      }).pipe(Effect.flip),
    )

    expect(error).toMatchObject({ code: 'capability_denied' })
  })

  it('stops a Session wait when its live derived child grant is removed', async () => {
    const liveProfile: LiveProfile = {
      capabilities: ['sessions:read'],
      scope: { sessionIds: ['parent'] },
      authorizationCeiling: 'yolo',
      revokedAt: null,
    }
    const derivedAuthorities = [
      {
        sessionId: 'worker',
        capabilities: ['sessions:read'] as const,
        authorizationCeiling: 'ask-for-approval' as const,
      },
    ]

    const error = await Effect.runPromise(
      dispatchEffect('wait', {
        liveProfile,
        derivedAuthorities,
        beforeObservation: () => {
          derivedAuthorities.length = 0
        },
      }).pipe(Effect.flip),
    )

    expect(error).toMatchObject({ code: 'target_scope_denied' })
  })

  it('passes the profile current scope and ceiling to an authorized observation', async () => {
    const liveProfile: LiveProfile = {
      capabilities: ['sessions:read'],
      scope: { sessionIds: ['worker'] },
      authorizationCeiling: 'yolo',
      revokedAt: null,
    }
    let observedAuthority: LocalSessionProfileAuthority | undefined

    await expect(
      Effect.runPromise(
        dispatchEffect('wait', {
          liveProfile,
          derivedAuthorities: [],
          beforeObservation: () => {
            liveProfile.scope = { all: true }
            liveProfile.authorizationCeiling = 'ask-for-approval'
          },
          observeAuthority: (authority) => {
            observedAuthority = authority
          },
        }),
      ),
    ).resolves.toBeDefined()
    expect(observedAuthority).toMatchObject({
      scope: { all: true },
      authorizationCeiling: 'ask-for-approval',
    })
  })
})
