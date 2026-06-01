import * as SqlClient from '@effect/sql/SqlClient'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { parseJsonUnknown, Schema, safeDecodeUnknown } from '@shared/schema'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { ExtensionLifecycleRepositoryError } from '../errors'
import type { ExtensionLifecycleState, ExtensionPackageScope } from '../extensions/types'
import { ExtensionLifecycleRepository } from '../ports/extension-lifecycle-repository'
import { SQLITE_BOOLEAN } from '../services/database-constants'

interface ExtensionLifecycleRow {
  readonly extension_id: string
  readonly scope_kind: string
  readonly scope_id: string
  readonly enabled: number
  readonly trusted: number
  readonly granted_capabilities_json: string
  readonly content_hash: string | null
  readonly sdk_range: string | null
  readonly sdk_compatible: number
  readonly diagnostics_json: string
  readonly installed_at: number
  readonly updated_at: number
}

const extensionDiagnosticsSchema = Schema.mutable(
  Schema.Array(
    Schema.Struct({
      severity: Schema.Literal(...OPENWAGGLE_EXTENSION.DIAGNOSTIC.SEVERITIES),
      code: Schema.Literal(...OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODES),
      message: Schema.String,
      path: Schema.optional(Schema.String),
    }),
  ),
)
const stringArraySchema = Schema.mutable(Schema.Array(Schema.String))

function booleanToSqlite(value: boolean) {
  return value ? SQLITE_BOOLEAN.TRUE : SQLITE_BOOLEAN.FALSE
}

function sqliteToBoolean(value: number) {
  return value === SQLITE_BOOLEAN.TRUE
}

function scopeToColumns(scope: ExtensionPackageScope) {
  return scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND
    ? {
        scopeKind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND,
        scopeId: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_ID,
      }
    : { scopeKind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, scopeId: scope.projectPath }
}

function scopeFromColumns(scopeKind: string, scopeId: string): ExtensionPackageScope {
  if (scopeKind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND) {
    return { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND }
  }
  if (scopeKind === OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND) {
    return { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: scopeId }
  }
  throw new Error(`Unknown extension lifecycle scope kind "${scopeKind}".`)
}

function decodeJsonField<A, I>(
  schema: Schema.Schema<A, I, never>,
  raw: string,
  fieldName: string,
): A {
  const parsed = parseJsonUnknown(raw)
  const decoded = safeDecodeUnknown(schema, parsed)
  if (!decoded.success) {
    throw new Error(`Invalid ${fieldName}: ${decoded.issues.join('; ')}`)
  }
  return decoded.data
}

function rowToLifecycleState(row: ExtensionLifecycleRow): ExtensionLifecycleState {
  return {
    extensionId: row.extension_id,
    scope: scopeFromColumns(row.scope_kind, row.scope_id),
    enabled: sqliteToBoolean(row.enabled),
    trusted: sqliteToBoolean(row.trusted),
    grantedCapabilities: decodeJsonField(
      stringArraySchema,
      row.granted_capabilities_json,
      'granted_capabilities_json',
    ),
    contentHash: row.content_hash,
    sdkRange: row.sdk_range,
    sdkCompatible: sqliteToBoolean(row.sdk_compatible),
    diagnostics: decodeJsonField(
      extensionDiagnosticsSchema,
      row.diagnostics_json,
      'diagnostics_json',
    ),
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
  }
}

function mapRepositoryError(operation: string, cause: unknown) {
  return new ExtensionLifecycleRepositoryError({ operation, cause })
}

function mapRows(operation: string, rows: readonly ExtensionLifecycleRow[]) {
  return Effect.try({
    try: () => rows.map(rowToLifecycleState),
    catch: (cause) => mapRepositoryError(operation, cause),
  })
}

export const SqliteExtensionLifecycleRepositoryLive = Layer.effect(
  ExtensionLifecycleRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    return ExtensionLifecycleRepository.of({
      get: (key) =>
        Effect.gen(function* () {
          const scope = scopeToColumns(key.scope)
          const rows = yield* sql<ExtensionLifecycleRow>`
          SELECT
            extension_id,
            scope_kind,
            scope_id,
            enabled,
            trusted,
            granted_capabilities_json,
            content_hash,
            sdk_range,
            sdk_compatible,
            diagnostics_json,
            installed_at,
            updated_at
          FROM extension_lifecycle_state
          WHERE extension_id = ${key.extensionId}
            AND scope_kind = ${scope.scopeKind}
            AND scope_id = ${scope.scopeId}
          LIMIT 1
        `
          const states = yield* mapRows('get', rows)
          return states[0] ?? null
        }).pipe(Effect.mapError((cause) => mapRepositoryError('get', cause))),
      list: (scope) =>
        Effect.gen(function* () {
          const columns = scopeToColumns(scope)
          const rows = yield* sql<ExtensionLifecycleRow>`
          SELECT
            extension_id,
            scope_kind,
            scope_id,
            enabled,
            trusted,
            granted_capabilities_json,
            content_hash,
            sdk_range,
            sdk_compatible,
            diagnostics_json,
            installed_at,
            updated_at
          FROM extension_lifecycle_state
          WHERE scope_kind = ${columns.scopeKind}
            AND scope_id = ${columns.scopeId}
          ORDER BY extension_id ASC
        `
          return yield* mapRows('list', rows)
        }).pipe(Effect.mapError((cause) => mapRepositoryError('list', cause))),
      upsert: (state) =>
        Effect.gen(function* () {
          const scope = scopeToColumns(state.scope)
          yield* sql`
          INSERT INTO extension_lifecycle_state (
            extension_id,
            scope_kind,
            scope_id,
            enabled,
            trusted,
            granted_capabilities_json,
            content_hash,
            sdk_range,
            sdk_compatible,
            diagnostics_json,
            installed_at,
            updated_at
          )
          VALUES (
            ${state.extensionId},
            ${scope.scopeKind},
            ${scope.scopeId},
            ${booleanToSqlite(state.enabled)},
            ${booleanToSqlite(state.trusted)},
            ${JSON.stringify(state.grantedCapabilities)},
            ${state.contentHash},
            ${state.sdkRange},
            ${booleanToSqlite(state.sdkCompatible)},
            ${JSON.stringify(state.diagnostics)},
            ${state.installedAt},
            ${state.updatedAt}
          )
          ON CONFLICT(extension_id, scope_kind, scope_id) DO UPDATE SET
            enabled = excluded.enabled,
            trusted = excluded.trusted,
            granted_capabilities_json = excluded.granted_capabilities_json,
            content_hash = excluded.content_hash,
            sdk_range = excluded.sdk_range,
            sdk_compatible = excluded.sdk_compatible,
            diagnostics_json = excluded.diagnostics_json,
            updated_at = excluded.updated_at
        `
        }).pipe(Effect.mapError((cause) => mapRepositoryError('upsert', cause))),
    })
  }),
)
