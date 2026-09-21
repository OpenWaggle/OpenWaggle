import * as SqlClient from '@effect/sql/SqlClient'
import { decodeUnknownExactOrThrow } from '@shared/schema'
import { desktopFenceRecordSchema } from '@shared/schemas/desktop-fence'
import { DESKTOP_SERVICE_LIMITS, type DesktopFenceRecord } from '@shared/types/desktop-service'
import { Effect, Layer } from 'effect'
import {
  DesktopFenceRepository,
  type DesktopFenceRepositoryShape,
} from '../ports/desktop-fence-repository'

interface FenceRow {
  readonly token: string
  readonly host_instance_id: string
  readonly scope_kind: string
  readonly scope_value: string
  readonly state: string
}

function decodeRecord(row: FenceRow) {
  if (row.scope_kind !== 'owner' && row.scope_kind !== 'path')
    throw new Error('Invalid persisted desktop fence scope.')
  return decodeUnknownExactOrThrow(desktopFenceRecordSchema, {
    token: row.token,
    hostInstanceId: row.host_instance_id,
    scope:
      row.scope_kind === 'owner'
        ? { kind: 'owner', ownerKey: row.scope_value }
        : { kind: 'path', directoryPath: row.scope_value },
    state: row.state,
  })
}

function insertFence(
  sql: SqlClient.SqlClient,
  input: DesktopFenceRecord & { readonly state: 'active' },
) {
  return sql.withTransaction(
    Effect.gen(function* () {
      const record = yield* Effect.try(() =>
        decodeUnknownExactOrThrow(desktopFenceRecordSchema, input),
      )
      if (record.state !== 'active')
        return yield* Effect.fail(new Error('Only active desktop fences can be inserted.'))
      const rows = yield* sql<{
        readonly count: number
      }>`SELECT COUNT(*) AS count FROM desktop_mutation_fences`
      if (!rows[0] || rows[0].count >= DESKTOP_SERVICE_LIMITS.fenceRecords) {
        return yield* Effect.fail(
          new Error(
            'Desktop mutation fence capacity exhausted; reconcile the connected desktop before retrying.',
          ),
        )
      }
      const value =
        record.scope.kind === 'owner' ? record.scope.ownerKey : record.scope.directoryPath
      yield* sql`INSERT INTO desktop_mutation_fences (token, host_instance_id, scope_kind, scope_value, state)
      VALUES (${record.token}, ${record.hostInstanceId}, ${record.scope.kind}, ${value}, ${'active'})`
    }),
  )
}

function changeFence(
  sql: SqlClient.SqlClient,
  token: string,
  hostInstanceId: string,
  action: 'release' | 'remove',
) {
  return sql.withTransaction(
    Effect.gen(function* () {
      const rows =
        yield* sql<FenceRow>`SELECT * FROM desktop_mutation_fences WHERE token = ${token} LIMIT 1`
      const row = rows[0]
      if (!row) {
        if (action === 'remove') return
        return yield* Effect.fail(new Error('Desktop mutation fence does not exist.'))
      }
      const record = yield* Effect.try(() => decodeRecord(row))
      if (record.hostInstanceId !== hostInstanceId)
        return yield* Effect.fail(new Error('Desktop mutation fence owner does not match.'))
      if (action === 'remove') {
        if (record.state !== 'released')
          return yield* Effect.fail(new Error('Active desktop mutation fences cannot be removed.'))
        yield* sql`DELETE FROM desktop_mutation_fences WHERE token = ${token} AND host_instance_id = ${hostInstanceId} AND state = ${'released'}`
      } else {
        yield* sql`UPDATE desktop_mutation_fences SET state = ${'released'} WHERE token = ${token} AND host_instance_id = ${hostInstanceId}`
      }
    }),
  )
}

export const SqliteDesktopFenceRepositoryLive = Layer.effect(
  DesktopFenceRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return {
      getAll: () =>
        Effect.gen(function* () {
          const rows =
            yield* sql<FenceRow>`SELECT * FROM desktop_mutation_fences ORDER BY token LIMIT ${DESKTOP_SERVICE_LIMITS.fenceRecords + 1}`
          if (rows.length > DESKTOP_SERVICE_LIMITS.fenceRecords)
            return yield* Effect.fail(
              new Error('Desktop mutation fence journal exceeds its supported capacity.'),
            )
          return yield* Effect.try(() => rows.map(decodeRecord))
        }),
      insert: (record) => insertFence(sql, record),
      markReleased: (token, hostInstanceId) => changeFence(sql, token, hostInstanceId, 'release'),
      removeReleased: (token, hostInstanceId) => changeFence(sql, token, hostInstanceId, 'remove'),
    } satisfies DesktopFenceRepositoryShape
  }),
)
