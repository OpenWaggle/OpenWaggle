import * as SqlClient from '@effect/sql/SqlClient'
import { decodeUnknownExactOrThrow } from '@shared/schema'
import { desktopOwnerRecordSchema } from '@shared/schemas/desktop-owner'
import { Effect, Layer } from 'effect'
import {
  DesktopOwnerRepository,
  type DesktopOwnerRepositoryShape,
} from '../ports/desktop-owner-repository'

function readOwner(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    const rows =
      yield* sql`SELECT gui_instance_id AS guiInstanceId, host_instance_id AS hostInstanceId, state
      FROM desktop_native_owner WHERE singleton = 1`
    return rows[0]
      ? yield* Effect.try(() => decodeUnknownExactOrThrow(desktopOwnerRecordSchema, rows[0]))
      : null
  })
}

export const SqliteDesktopOwnerRepositoryLive = Layer.effect(
  DesktopOwnerRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return {
      get: () => readOwner(sql),
      activate: (owner) =>
        sql.withTransaction(
          Effect.gen(function* () {
            const next = yield* Effect.try(() =>
              decodeUnknownExactOrThrow(desktopOwnerRecordSchema, { ...owner, state: 'active' }),
            )
            const current = yield* readOwner(sql)
            if (current?.state === 'active' && current.guiInstanceId !== next.guiInstanceId) {
              return yield* Effect.fail(
                new Error(
                  'The previous desktop has not confirmed native resource cleanup. Reconnect it and close it safely before attaching another desktop.',
                ),
              )
            }
            yield* sql`INSERT INTO desktop_native_owner (singleton, gui_instance_id, host_instance_id, state)
        VALUES (1, ${next.guiInstanceId}, ${next.hostInstanceId}, ${'active'})
        ON CONFLICT(singleton) DO UPDATE SET gui_instance_id = excluded.gui_instance_id,
          host_instance_id = excluded.host_instance_id, state = excluded.state`
          }),
        ),
      markClosed: (guiInstanceId, hostInstanceId) =>
        sql.withTransaction(
          Effect.gen(function* () {
            const current = yield* readOwner(sql)
            if (
              !current ||
              current.guiInstanceId !== guiInstanceId ||
              current.hostInstanceId !== hostInstanceId
            ) {
              return yield* Effect.fail(
                new Error('The native cleanup receipt does not match the current desktop owner.'),
              )
            }
            yield* sql`UPDATE desktop_native_owner SET state = ${'closed'} WHERE singleton = 1`
          }),
        ),
    } satisfies DesktopOwnerRepositoryShape
  }),
)
