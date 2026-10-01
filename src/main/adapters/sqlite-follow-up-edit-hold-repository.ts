import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionControlRepositoryError } from '../errors'
import { FollowUpEditHoldRepository } from '../ports/follow-up-edit-hold-repository'
import { monotonicNowMs } from '../utils/monotonic-clock'
import {
  listExpiredFollowUpEditHolds,
  listFollowUpEditHeldSessions,
  renewFollowUpEditHold,
  retainFollowUpEditAttachments,
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
        renewFollowUpEditHold(sql, { ...input, now: monotonicNowMs() }).pipe(
          Effect.mapError(repositoryError('renew-follow-up-edit-hold')),
        ),
      listExpired: () =>
        listExpiredFollowUpEditHolds(sql, monotonicNowMs()).pipe(
          Effect.mapError(repositoryError('list-expired-follow-up-edit-holds')),
        ),
      heldSessions: () =>
        listFollowUpEditHeldSessions(sql, monotonicNowMs()).pipe(
          Effect.mapError(repositoryError('list-follow-up-edit-held-sessions')),
        ),
      retainAttachments: (input) =>
        retainFollowUpEditAttachments(sql, input, monotonicNowMs()).pipe(
          Effect.mapError(repositoryError('retain-follow-up-edit-attachments')),
        ),
    })
  }),
)
