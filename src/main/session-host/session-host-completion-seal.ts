import { decodeUnknownExactOrThrow, decodeUnknownOrThrow, Schema } from '@shared/schema'
import { migrationIdentitySchema } from '@shared/schemas/migration-ledger'
import {
  planSessionHostLedgerUpgrade,
  SESSION_HOST_ALPHA_BASELINE_ID,
  SESSION_HOST_LEDGER_PAGE_SIZE,
} from '../services/session-host-ledger-compatibility'
import {
  SESSION_HOST_BASELINE_MIGRATION_ID,
  SESSION_HOST_BASELINE_MIGRATION_NAME,
  SESSION_HOST_CUTOVER_REVISION,
  SESSION_HOST_FRESH_REVISION,
  SESSION_HOST_SCHEMA_REVISION,
  SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID,
} from '../services/session-host-schema-identity'
import type { HostSqliteDatabase } from './host-sqlite-database'
import { queryCutoverRow } from './session-host-cutover-database'

const nonNegativeIntegerSchema = Schema.Number.pipe(Schema.int(), Schema.nonNegative())

/** A cutover's source counts, with exactly these keys. */
const cutoverHighWatermarkSchema = Schema.Struct({
  sessions: nonNegativeIntegerSchema,
  nodes: nonNegativeIntegerSchema,
  sourceSchemaRevision: nonNegativeIntegerSchema,
})

/** A fresh install's high-water mark: `{}`. An empty Struct schema would accept any object. */
function isEmptyObject(value: unknown) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  )
}

function decodesExactly(schema: Schema.Schema.AnyNoContext, value: unknown) {
  try {
    decodeUnknownExactOrThrow(schema, value)
    return true
  } catch {
    return false
  }
}

function validHighWatermark(revision: string, value: string) {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return false
  }
  if (revision === SESSION_HOST_FRESH_REVISION) return isEmptyObject(parsed)
  return !Array.isArray(parsed) && decodesExactly(cutoverHighWatermarkSchema, parsed)
}

const completionSealRowSchema = Schema.Struct({
  schema_revision: Schema.Literal(SESSION_HOST_SCHEMA_REVISION),
  migration_revision: Schema.Literal(SESSION_HOST_FRESH_REVISION, SESSION_HOST_CUTOVER_REVISION),
  source_high_watermark_json: Schema.String,
  completed_at: Schema.Number.pipe(Schema.int(), Schema.positive()),
  ledger_name: Schema.Literal(SESSION_HOST_BASELINE_MIGRATION_NAME),
  ledger_applied_at: Schema.String.pipe(Schema.minLength(1)),
  max_migration_id: nonNegativeIntegerSchema.pipe(
    Schema.lessThanOrEqualTo(SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID),
  ),
})

/**
 * O(1) startup validation for an already-installed target. The seal is written only after the
 * staging database passes full validation, in the same transaction as the migration ledger row.
 */
export function validateSessionHostCompletionSeal(database: HostSqliteDatabase) {
  const rows = decodeUnknownOrThrow(
    Schema.Array(migrationIdentitySchema),
    database
      .prepare(
        `SELECT id, name FROM _migrations WHERE id >= ${SESSION_HOST_ALPHA_BASELINE_ID} ORDER BY id LIMIT ${SESSION_HOST_LEDGER_PAGE_SIZE}`,
      )
      .all(),
  )
  let baselineId: number
  try {
    planSessionHostLedgerUpgrade(rows)
    baselineId =
      rows.find((row) => row.name === SESSION_HOST_BASELINE_MIGRATION_NAME)?.id ??
      SESSION_HOST_BASELINE_MIGRATION_ID
  } catch {
    throw new Error('Session Host target completion metadata is missing or incompatible.')
  }
  const seal = queryCutoverRow(
    database,
    completionSealRowSchema,
    `SELECT metadata.schema_revision, metadata.migration_revision,
      metadata.source_high_watermark_json, metadata.completed_at,
      ledger.name AS ledger_name, ledger.applied_at AS ledger_applied_at,
      (SELECT MAX(id) FROM _migrations) AS max_migration_id
    FROM session_host_schema_metadata AS metadata
    LEFT JOIN _migrations AS ledger ON ledger.id = ${baselineId}
    WHERE metadata.singleton = 1`,
  )
  const valid =
    seal !== undefined &&
    validHighWatermark(seal.migration_revision, seal.source_high_watermark_json)
  if (!valid) throw new Error('Session Host target completion metadata is missing or incompatible.')
}
