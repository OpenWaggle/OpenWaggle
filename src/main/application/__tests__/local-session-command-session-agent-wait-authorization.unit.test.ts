import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
import { LocalSessionProfileRepository } from '../../ports/local-session-profile-repository'
import { SessionAuthorizationTargetRepository } from '../../ports/session-authorization-target-repository'
import {
  SessionQueryRepository,
  type SessionQueryRepositoryShape,
} from '../../ports/session-query-repository'
import { SessionWaitService } from '../../ports/session-wait-service'
import { SettingsService } from '../../services/settings-service'
import {
  dispatchSessionRepositoryQuery,
  dispatchSessionWaitQuery,
} from '../local-session-query-dispatcher'

const sessionAgentAuthority = {
  profileId: 'session-agent:queen',
  profileName: 'session-agent:queen',
  capabilities: ['sessions:read', 'sessions:export'],
  scope: { sessionIds: ['worker'] },
  authorizationCeiling: 'ask-for-approval',
} as const

const sessionAgent: LocalSessionCallerIdentity = {
  callerId: 'session-agent:queen:run-1',
  profileAuthority: sessionAgentAuthority,
}

function payload(operation: 'wait' | 'exports-wait') {
  return {
    contract: 'session-query-v2',
    request: {
      contractVersion: 2,
      requestId: `request-${operation}`,
      query:
        operation === 'wait'
          ? {
              operation,
              targets: [{ sessionId: 'worker', condition: 'idle' }],
              timeoutMs: 1_000,
            }
          : {
              operation,
              sessionId: 'worker',
              exportOperationId: 'export-1',
              timeoutMs: 1_000,
            },
    },
  } satisfies LocalSessionCommandPayload
}

function testLayer(
  settleWithoutObservation = false,
  execute: SessionQueryRepositoryShape['execute'] = () =>
    Effect.die('Direct queries are not used in this test.'),
) {
  const observe = (operation: 'wait' | 'exports-wait') => {
    if (!settleWithoutObservation) {
      return Effect.tryPromise({
        try: async () => {
          throw new Error('Observation unexpectedly retained stale authority.')
        },
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      })
    }
    return Effect.succeed({
      contractVersion: 2 as const,
      requestId: `request-${operation}`,
      outcome:
        operation === 'wait'
          ? {
              operation,
              timedOut: true,
              matchedSessionIds: [],
              cursor: { hostInstanceId: 'host', sequence: 0 },
              states: [],
            }
          : {
              operation,
              error: { code: 'export_not_found' as const, message: 'irrelevant' },
            },
    })
  }
  return Layer.mergeAll(
    Layer.succeed(LocalSessionProfileRepository, {
      list: () => Effect.succeed([]),
      findForAuthentication: () => Effect.succeed(null),
      findById: () => Effect.succeed(null),
      recordAuthentication: () => Effect.void,
      executeManagement: () => Effect.die('Profile management is not used in this test.'),
    }),
    Layer.succeed(SessionAuthorizationTargetRepository, {
      resolve: (sessionId) =>
        Effect.succeed({
          sessionId,
          projectPath: '/project',
          hiveRootSessionId: 'queen',
          authorizationCeiling: 'ask-for-approval' as const,
        }),
      resolveDelegation: () => Effect.die('Delegations are not used in this test.'),
      listLiveDerivedAuthorities: () => Effect.succeed([]),
    }),
    Layer.succeed(SessionWaitService, {
      wait: ({ resolveObservationAuthority }) =>
        settleWithoutObservation
          ? observe('wait')
          : Effect.tryPromise({
              try: async () => {
                await resolveObservationAuthority?.()
                throw new Error('Observation unexpectedly retained stale authority.')
              },
              catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
            }),
      waitForExport: ({ resolveObservationAuthority }) =>
        settleWithoutObservation
          ? observe('exports-wait')
          : Effect.tryPromise({
              try: async () => {
                await resolveObservationAuthority?.()
                throw new Error('Observation unexpectedly retained stale authority.')
              },
              catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
            }),
    }),
    Layer.succeed(SessionQueryRepository, {
      execute,
    }),
    Layer.succeed(SettingsService, {
      get: () => Effect.succeed(DEFAULT_SETTINGS),
      update: () => Effect.void,
      initialize: () => Effect.void,
      flushForTests: () => Effect.void,
    }),
  )
}

describe('Session-agent wait authority', () => {
  it('reexecutes a fresh search under live Session-agent authority', async () => {
    const searchAgent: LocalSessionCallerIdentity = {
      callerId: 'session-agent:queen:run-1',
      profileAuthority: {
        ...sessionAgentAuthority,
        capabilities: ['sessions:discover', 'sessions:read'],
        scope: { all: true },
      },
    }
    const command = {
      contract: 'session-query-v2',
      request: {
        contractVersion: 2,
        requestId: 'request-search',
        query: {
          operation: 'search',
          query: 'live authority',
          mode: 'semantic',
          requireFresh: true,
          waitTimeoutMs: 1_000,
          limit: 10,
        },
      },
    } as const satisfies LocalSessionCommandPayload
    const execute = vi.fn<SessionQueryRepositoryShape['execute']>((input) =>
      Effect.succeed({
        contractVersion: 2,
        requestId: input.request.requestId,
        outcome: {
          operation: 'search',
          sessions: [],
          requestedSearchMode: 'semantic',
          searchBackend: 'semantic',
        },
      }),
    )

    await Effect.runPromise(
      dispatchSessionRepositoryQuery(searchAgent, command, undefined, () =>
        Promise.resolve(searchAgent),
      ).pipe(Effect.provide(testLayer(false, execute))),
    )

    expect(execute).toHaveBeenCalledTimes(2)
  })

  it.each(['wait', 'exports-wait'] as const)(
    're-resolves native %s authority before every observation',
    async (operation) => {
      const command = payload(operation)
      if (command.contract !== 'session-query-v2') throw new Error('Expected Session query.')
      let resolutions = 0
      const resolveLiveCaller = async (): Promise<LocalSessionCallerIdentity> => {
        resolutions += 1
        return {
          ...sessionAgent,
          profileAuthority: {
            ...sessionAgentAuthority,
            capabilities: [],
            scope: { sessionIds: ['queen'] },
          },
        }
      }

      const error = await Effect.runPromise(
        dispatchSessionWaitQuery(sessionAgent, command, undefined, resolveLiveCaller).pipe(
          Effect.provide(testLayer()),
          Effect.flip,
        ),
      )

      expect(error).toMatchObject({ code: 'capability_denied' })
      expect(resolutions).toBe(1)
    },
  )

  it.each(['wait', 'exports-wait'] as const)(
    're-resolves native %s authority after a settled observation',
    async (operation) => {
      const command = payload(operation)
      if (command.contract !== 'session-query-v2') throw new Error('Expected Session query.')
      let resolutions = 0
      const error = await Effect.runPromise(
        dispatchSessionWaitQuery(sessionAgent, command, undefined, async () => {
          resolutions += 1
          return {
            ...sessionAgent,
            profileAuthority: { ...sessionAgentAuthority, capabilities: [] },
          }
        }).pipe(Effect.provide(testLayer(true)), Effect.flip),
      )

      expect(error).toMatchObject({ code: 'capability_denied' })
      expect(resolutions).toBe(1)
    },
  )
})
