import * as SqlClient from '@effect/sql/SqlClient'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { ExtensionProjectOverrideRepositoryError } from '../errors'
import type {
  ExtensionPackageScope,
  ExtensionProjectOverrideKey,
  ExtensionProjectOverrideState,
} from '../extensions/types'
import { ExtensionProjectOverridesRepository } from '../ports/extension-project-overrides-repository'
import { SQLITE_BOOLEAN } from '../services/database-constants'

interface ExtensionProjectOverrideRow {
  readonly extension_id: string
  readonly scope_kind: string
  readonly scope_id: string
  readonly project_path: string
  readonly disabled: number
  readonly created_at: number
  readonly updated_at: number
}

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
  throw new Error(`Unknown extension project override scope kind "${scopeKind}".`)
}

function rowToProjectOverrideState(
  row: ExtensionProjectOverrideRow,
): ExtensionProjectOverrideState {
  return {
    extensionId: row.extension_id,
    scope: scopeFromColumns(row.scope_kind, row.scope_id),
    projectPath: row.project_path,
    disabled: sqliteToBoolean(row.disabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapRepositoryError(
  operation: string,
  cause: unknown,
): ExtensionProjectOverrideRepositoryError {
  return new ExtensionProjectOverrideRepositoryError({ operation, cause })
}

function mapRows(operation: string, rows: readonly ExtensionProjectOverrideRow[]) {
  return Effect.try({
    try: () => rows.map(rowToProjectOverrideState),
    catch: (cause) => mapRepositoryError(operation, cause),
  })
}

export const SqliteExtensionProjectOverridesRepositoryLive = Layer.effect(
  ExtensionProjectOverridesRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    return ExtensionProjectOverridesRepository.of({
      get: (key: ExtensionProjectOverrideKey) =>
        Effect.gen(function* () {
          const scope = scopeToColumns(key.scope)
          const rows = yield* sql<ExtensionProjectOverrideRow>`
            SELECT
              extension_id,
              scope_kind,
              scope_id,
              project_path,
              disabled,
              created_at,
              updated_at
            FROM extension_project_overrides
            WHERE extension_id = ${key.extensionId}
              AND scope_kind = ${scope.scopeKind}
              AND scope_id = ${scope.scopeId}
              AND project_path = ${key.projectPath}
            LIMIT 1
          `
          const states = yield* mapRows('get', rows)
          return states[0] ?? null
        }).pipe(Effect.mapError((cause) => mapRepositoryError('get', cause))),
      upsert: (state: ExtensionProjectOverrideState) =>
        Effect.gen(function* () {
          const scope = scopeToColumns(state.scope)
          yield* sql`
            INSERT INTO extension_project_overrides (
              extension_id,
              scope_kind,
              scope_id,
              project_path,
              disabled,
              created_at,
              updated_at
            )
            VALUES (
              ${state.extensionId},
              ${scope.scopeKind},
              ${scope.scopeId},
              ${state.projectPath},
              ${booleanToSqlite(state.disabled)},
              ${state.createdAt},
              ${state.updatedAt}
            )
            ON CONFLICT(extension_id, scope_kind, scope_id, project_path) DO UPDATE SET
              disabled = excluded.disabled,
              updated_at = excluded.updated_at
          `
        }).pipe(Effect.mapError((cause) => mapRepositoryError('upsert', cause))),
    })
  }),
)
