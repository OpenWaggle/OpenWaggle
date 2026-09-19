import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { authorizeLocalSessionCommand } from '../local-session-command-authorization'
import {
  authorizationLayer,
  restrictedCaller,
} from './local-session-command-dispatcher.test-support'

function conflictsQuery(
  filters: {
    readonly projectPath?: string
    readonly workingPath?: string
    readonly delegationId?: string
  } = {},
) {
  return {
    contract: 'session-query-v2',
    request: {
      contractVersion: 2,
      requestId: 'conflicts-query',
      query: { operation: 'delegations-conflicts', limit: 10, ...filters },
    },
  } as const satisfies LocalSessionCommandPayload
}

describe('Delegation conflict catalog authorization', () => {
  it.each([
    { scope: { sessionIds: ['session-worker'] } },
    { scope: { hiveRootSessionIds: ['session-queen'] } },
  ])('admits an unscoped catalog query for an exact $scope profile', async ({ scope }) => {
    const caller = restrictedCaller({ capabilities: ['delegations:read'], scope })
    for (const payload of [conflictsQuery({ workingPath: '/allowed-project' }), conflictsQuery()]) {
      await expect(
        Effect.runPromise(
          authorizeLocalSessionCommand({ caller, payload }).pipe(
            Effect.provide(authorizationLayer),
          ),
        ),
      ).resolves.toBeUndefined()
    }
  })

  it('requires the delegation read capability for catalog discovery', async () => {
    await expect(
      Effect.runPromise(
        authorizeLocalSessionCommand({
          caller: restrictedCaller({
            capabilities: ['sessions:discover'],
            scope: { sessionIds: ['session-worker'] },
          }),
          payload: conflictsQuery(),
        }).pipe(Effect.provide(authorizationLayer), Effect.flip),
      ),
    ).resolves.toMatchObject({ code: 'capability_denied' })
  })

  it('keeps explicit project and delegation targets subject to scope checks', async () => {
    const caller = restrictedCaller({
      capabilities: ['delegations:read'],
      scope: { sessionIds: ['session-worker'] },
    })
    for (const payload of [
      conflictsQuery({ projectPath: '/other-project' }),
      conflictsQuery({ delegationId: 'another-delegation' }),
    ]) {
      await expect(
        Effect.runPromise(
          authorizeLocalSessionCommand({ caller, payload }).pipe(
            Effect.provide(authorizationLayer),
            Effect.flip,
          ),
        ),
      ).resolves.toMatchObject({ code: 'target_scope_denied' })
    }
  })
})
