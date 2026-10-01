import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionControlRepositoryError } from '../errors'
import { FollowUpEditHoldRepository } from '../ports/follow-up-edit-hold-repository'
import {
  listFollowUpEditHeldSessions,
  renewFollowUpEditHold,
  takeExpiredFollowUpEditHolds,
} from './sqlite-follow-up-edit-holds'

function repositoryError(operation: string) {
  return (cause: unknown) => new SessionControlRepositoryError({ operation, cause })
}

export const SqliteFollowUpEditHoldRepositoryLive = Layer.effect(
  FollowUpEditHoldRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return FollowUpEditHoldRepository.of({
      renew: (input) =>
        renewFollowUpEditHold(sql, { ...input, now: Date.now() }).pipe(
          Effect.mapError(repositoryError('renew-follow-up-edit-hold')),
        ),
      takeExpired: () =>
        takeExpiredFollowUpEditHolds(sql, Date.now()).pipe(
          Effect.mapError(repositoryError('take-expired-follow-up-edit-holds')),
        ),
      heldSessions: () =>
        listFollowUpEditHeldSessions(sql, Date.now()).pipe(
          Effect.mapError(repositoryError('list-follow-up-edit-held-sessions')),
        ),
    })
  }),
)
