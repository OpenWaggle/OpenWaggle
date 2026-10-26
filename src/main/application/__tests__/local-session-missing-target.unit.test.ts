import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import {
  LocalSessionCommandAuthorizationError,
  SessionAuthorizationTargetRepositoryError,
} from '../../errors'
import { SessionAuthorizationTargetRepository } from '../../ports/session-authorization-target-repository'
import { settingsLayer } from './local-session-command-dispatcher.test-support'

const { authorizeLocalSessionCommand } = await import('../local-session-command-authorization')
const { answerMissingTarget } = await import('../local-session-missing-target')

/** Sessions in two projects; `session-unknown` does not exist. */
const layer = Layer.mergeAll(
  settingsLayer,
  Layer.succeed(SessionAuthorizationTargetRepository, {
    resolve: (sessionId) =>
      sessionId === 'session-unknown'
        ? Effect.fail(
            new SessionAuthorizationTargetRepositoryError({
              operation: 'session-not-found',
              cause: { sessionId },
            }),
          )
        : Effect.succeed({
            sessionId,
            projectPath: sessionId === 'queen-b' ? '/project-b' : '/project-a',
            hiveRootSessionId: sessionId,
            authorizationCeiling: 'ask-for-approval',
          }),
    resolveDelegation: () =>
      Effect.fail(
        new SessionAuthorizationTargetRepositoryError({ operation: 'delegation-not-found' }),
      ),
    runInputWidensReach: () => Effect.succeed(false),
    listLiveDerivedAuthorities: () => Effect.succeed([]),
  }),
)

const scopedCaller = {
  callerId: 'profile:reviewer',
  profileAuthority: {
    profileId: 'reviewer',
    profileName: 'reviewer',
    capabilities: ['delegations:read' as const, 'sessions:message' as const],
    scope: { projectPaths: ['/project-a'] },
    authorizationCeiling: 'ask-for-approval' as const,
  },
}

function delegationsList(filter: { parentSessionId?: string; workerSessionId?: string }) {
  return {
    contract: 'session-query-v2',
    request: {
      contractVersion: 2,
      requestId: 'list',
      query: { operation: 'delegations-list', limit: 10, ...filter },
    },
  } as const satisfies LocalSessionCommandPayload
}

function run(payload: LocalSessionCommandPayload) {
  return Effect.runPromise(
    authorizeLocalSessionCommand({ caller: scopedCaller, payload }).pipe(
      Effect.as('authorized' as const),
      answerMissingTarget(payload),
      Effect.catchAll((error) => Effect.succeed(error)),
      Effect.provide(layer),
    ),
  )
}

describe('one not-found answer and scoped Delegation filters (#351)', () => {
  it('refuses delegations-list --parent or --worker outside the scope, like read and status', async () => {
    for (const filter of [{ parentSessionId: 'queen-b' }, { workerSessionId: 'queen-b' }]) {
      await expect(run(delegationsList(filter))).resolves.toEqual(
        new LocalSessionCommandAuthorizationError({ code: 'target_scope_denied' }),
      )
    }
    await expect(run(delegationsList({ parentSessionId: 'queen-a' }))).resolves.toBe('authorized')
  })

  it('refuses list --parent outside the scope, like delegations-list (#352)', async () => {
    // Built as a value, so it compiles before and after the list query declares the field.
    const listQuery = { operation: 'list' as const, limit: 10, parentSessionId: 'queen-b' }
    const list = (query: typeof listQuery) =>
      ({
        contract: 'session-query-v2',
        request: { contractVersion: 2, requestId: 'list', query },
      }) as const
    const discoverCaller = {
      ...scopedCaller,
      profileAuthority: {
        ...scopedCaller.profileAuthority,
        capabilities: ['sessions:discover' as const],
      },
    }
    const runList = (query: typeof listQuery) =>
      Effect.runPromise(
        authorizeLocalSessionCommand({ caller: discoverCaller, payload: list(query) }).pipe(
          Effect.as('authorized' as const),
          Effect.catchAll((error) => Effect.succeed(error)),
          Effect.provide(layer),
        ),
      )

    await expect(runList(listQuery)).resolves.toEqual(
      new LocalSessionCommandAuthorizationError({ code: 'target_scope_denied' }),
    )
    await expect(runList({ ...listQuery, parentSessionId: 'queen-a' })).resolves.toBe('authorized')
  })

  it('answers an unknown Session with session_not_found for every contract', async () => {
    await expect(run(delegationsList({ parentSessionId: 'session-unknown' }))).resolves.toEqual({
      contract: 'session-query-v2',
      response: {
        contractVersion: 2,
        requestId: 'list',
        outcome: {
          operation: 'delegations-list',
          error: { code: 'session_not_found', message: 'The Session was not found.' },
        },
      },
    })
    await expect(
      run({
        contract: 'session-control-v2',
        request: {
          contractVersion: 2,
          requestId: 'follow-up',
          idempotencyKey: 'key',
          command: {
            operation: 'follow-up',
            sessionId: 'session-unknown',
            input: { text: 'hi', attachmentIds: [] },
          },
        },
      }),
    ).resolves.toEqual({
      contract: 'session-control-v2',
      response: {
        contractVersion: 2,
        requestId: 'follow-up',
        idempotencyKey: 'key',
        replayed: false,
        outcome: {
          operation: 'follow-up',
          effect: 'rejected',
          sessionId: 'session-unknown',
          code: 'session_not_found',
        },
      },
    })
  })

  it('answers an unknown Delegation with delegation_not_found', async () => {
    await expect(
      run({
        contract: 'session-query-v2',
        request: {
          contractVersion: 2,
          requestId: 'read',
          query: { operation: 'delegations-read', delegationId: 'delegation-unknown' },
        },
      }),
    ).resolves.toMatchObject({
      response: { outcome: { error: { code: 'delegation_not_found' } } },
    })
  })
})
