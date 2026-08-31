import type { DatabaseSync } from 'node:sqlite'
import {
  SESSION_HOST_BASELINE_MIGRATION_ID,
  SESSION_HOST_BASELINE_MIGRATION_NAME,
  SESSION_HOST_CUTOVER_REVISION,
  SESSION_HOST_FRESH_REVISION,
  SESSION_HOST_SCHEMA_REVISION,
  SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID,
} from '../services/session-host-schema-identity'
import { queryCutoverRecord } from './session-host-cutover-database'

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function parseHighWatermark(value: unknown) {
  if (typeof value !== 'string') return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed))
      : undefined
  } catch {
    return undefined
  }
}

function validHighWatermark(revision: unknown, value: unknown) {
  const highWatermark = parseHighWatermark(value)
  if (!highWatermark) return false
  if (revision === SESSION_HOST_FRESH_REVISION) return Object.keys(highWatermark).length === 0
  if (revision !== SESSION_HOST_CUTOVER_REVISION) return false
  return (
    Object.keys(highWatermark).sort().join(',') === 'nodes,sessions,sourceSchemaRevision' &&
    nonNegativeInteger(highWatermark.sessions) &&
    nonNegativeInteger(highWatermark.nodes) &&
    nonNegativeInteger(highWatermark.sourceSchemaRevision)
  )
}

/**
 * O(1) startup validation for an already-installed target. The seal is written only after the
 * staging database passes full validation, in the same transaction as the migration ledger row.
 */
export function validateSessionHostCompletionSeal(database: DatabaseSync) {
  const seal = queryCutoverRecord(
    database,
    `SELECT metadata.schema_revision, metadata.migration_revision,
      metadata.source_high_watermark_json, metadata.completed_at,
      ledger.name AS ledger_name, ledger.applied_at AS ledger_applied_at,
      (SELECT MAX(id) FROM _migrations) AS max_migration_id
    FROM session_host_schema_metadata AS metadata
    LEFT JOIN _migrations AS ledger ON ledger.id = ${SESSION_HOST_BASELINE_MIGRATION_ID}
    WHERE metadata.singleton = 1`,
  )
  const valid =
    seal?.schema_revision === SESSION_HOST_SCHEMA_REVISION &&
    (seal.migration_revision === SESSION_HOST_FRESH_REVISION ||
      seal.migration_revision === SESSION_HOST_CUTOVER_REVISION) &&
    validHighWatermark(seal.migration_revision, seal.source_high_watermark_json) &&
    positiveInteger(seal.completed_at) &&
    seal.ledger_name === SESSION_HOST_BASELINE_MIGRATION_NAME &&
    typeof seal.ledger_applied_at === 'string' &&
    seal.ledger_applied_at.length > 0 &&
    nonNegativeInteger(seal.max_migration_id) &&
    seal.max_migration_id <= SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID
  if (!valid) throw new Error('Session Host target completion metadata is missing or incompatible.')
}
