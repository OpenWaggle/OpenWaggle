import * as SqlClient from '@effect/sql/SqlClient'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { parseJsonUnknown, safeDecodeUnknown } from '@shared/schema'
import { jsonValueSchema } from '@shared/schemas/validation'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { ExtensionStorageRepositoryError } from '../errors'
import type { ExtensionPackageScope } from '../extensions/types'
import {
  type ExtensionStorageItem,
  type ExtensionStorageKey,
  type ExtensionStorageKeyListInput,
  type ExtensionStorageKind,
  ExtensionStorageRepository,
  type ExtensionStorageScope,
} from '../ports/extension-storage-repository'

interface ExtensionStorageRow {
  readonly extension_id: string
  readonly package_scope_kind: string
  readonly package_scope_id: string
  readonly storage_kind: string
  readonly storage_scope_kind: string
  readonly storage_scope_id: string
  readonly key: string
  readonly value_json: string
  readonly created_at: number
  readonly updated_at: number
}

function packageScopeToCols(scope: ExtensionPackageScope) {
  return scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND
    ? {
        kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND,
        id: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_ID,
      }
    : {
        kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND,
        id: scope.projectPath,
      }
}

function packageScopeFromCols(kind: string, id: string): ExtensionPackageScope {
  if (kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND) {
    return { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND }
  }
  if (kind === OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND) {
    return { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: id }
  }
  throw new Error(`Unknown extension storage package scope kind "${kind}".`)
}

function storageScopeToCols(scope: ExtensionStorageScope) {
  return scope.kind === OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND
    ? {
        kind: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND,
        id: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_ID,
      }
    : {
        kind: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND,
        id: scope.projectPath,
      }
}

function storageScopeFromCols(kind: string, id: string): ExtensionStorageScope {
  if (kind === OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND) {
    return { kind: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND }
  }
  if (kind === OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND) {
    return { kind: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND, projectPath: id }
  }
  throw new Error(`Unknown extension storage scope kind "${kind}".`)
}

function decodeStorageKind(raw: string): ExtensionStorageKind {
  if (raw === OPENWAGGLE_EXTENSION.STORAGE.KIND.STATE) {
    return OPENWAGGLE_EXTENSION.STORAGE.KIND.STATE
  }
  if (raw === OPENWAGGLE_EXTENSION.STORAGE.KIND.CONFIG) {
    return OPENWAGGLE_EXTENSION.STORAGE.KIND.CONFIG
  }
  throw new Error(`Unknown extension storage kind "${raw}".`)
}

function decodeValue(raw: string) {
  const decoded = safeDecodeUnknown(jsonValueSchema, parseJsonUnknown(raw))
  if (!decoded.success) {
    throw new Error(`Invalid extension storage JSON value: ${decoded.issues.join('; ')}`)
  }
  return decoded.data
}

function rowToItem(row: ExtensionStorageRow): ExtensionStorageItem {
  return {
    extensionId: row.extension_id,
    packageScope: packageScopeFromCols(row.package_scope_kind, row.package_scope_id),
    storageKind: decodeStorageKind(row.storage_kind),
    storageScope: storageScopeFromCols(row.storage_scope_kind, row.storage_scope_id),
    key: row.key,
    value: decodeValue(row.value_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function repoErr(operation: string, cause: unknown) {
  return new ExtensionStorageRepositoryError({ operation, cause })
}

function mapRows(operation: string, rows: readonly ExtensionStorageRow[]) {
  return Effect.try({
    try: () => rows.map(rowToItem),
    catch: (cause) => repoErr(operation, cause),
  })
}

function getItem(sql: SqlClient.SqlClient, key: ExtensionStorageKey) {
  return Effect.gen(function* () {
    const packageScope = packageScopeToCols(key.packageScope)
    const storageScope = storageScopeToCols(key.storageScope)
    const rows = yield* sql<ExtensionStorageRow>`
      SELECT
        extension_id,
        package_scope_kind,
        package_scope_id,
        storage_kind,
        storage_scope_kind,
        storage_scope_id,
        key,
        value_json,
        created_at,
        updated_at
      FROM extension_storage_items
      WHERE extension_id = ${key.extensionId}
        AND package_scope_kind = ${packageScope.kind}
        AND package_scope_id = ${packageScope.id}
        AND storage_kind = ${key.storageKind}
        AND storage_scope_kind = ${storageScope.kind}
        AND storage_scope_id = ${storageScope.id}
        AND key = ${key.key}
      LIMIT 1
    `
    const items = yield* mapRows('get', rows)
    return items[0] ?? null
  }).pipe(Effect.mapError((cause) => repoErr('get', cause)))
}

function upsertItem(sql: SqlClient.SqlClient, item: ExtensionStorageItem) {
  return Effect.gen(function* () {
    const packageScope = packageScopeToCols(item.packageScope)
    const storageScope = storageScopeToCols(item.storageScope)
    yield* sql`
      INSERT INTO extension_storage_items (
        extension_id,
        package_scope_kind,
        package_scope_id,
        storage_kind,
        storage_scope_kind,
        storage_scope_id,
        key,
        value_json,
        created_at,
        updated_at
      )
      VALUES (
        ${item.extensionId},
        ${packageScope.kind},
        ${packageScope.id},
        ${item.storageKind},
        ${storageScope.kind},
        ${storageScope.id},
        ${item.key},
        ${JSON.stringify(item.value)},
        ${item.createdAt},
        ${item.updatedAt}
      )
      ON CONFLICT(
        extension_id,
        package_scope_kind,
        package_scope_id,
        storage_kind,
        storage_scope_kind,
        storage_scope_id,
        key
      ) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `
  }).pipe(Effect.mapError((cause) => repoErr('upsert', cause)))
}

function deleteItem(sql: SqlClient.SqlClient, key: ExtensionStorageKey) {
  return Effect.gen(function* () {
    const packageScope = packageScopeToCols(key.packageScope)
    const storageScope = storageScopeToCols(key.storageScope)
    yield* sql`
      DELETE FROM extension_storage_items
      WHERE extension_id = ${key.extensionId}
        AND package_scope_kind = ${packageScope.kind}
        AND package_scope_id = ${packageScope.id}
        AND storage_kind = ${key.storageKind}
        AND storage_scope_kind = ${storageScope.kind}
        AND storage_scope_id = ${storageScope.id}
        AND key = ${key.key}
    `
  }).pipe(Effect.mapError((cause) => repoErr('delete', cause)))
}

function listKeys(sql: SqlClient.SqlClient, input: ExtensionStorageKeyListInput) {
  return Effect.gen(function* () {
    const packageScope = packageScopeToCols(input.packageScope)
    const storageScope = storageScopeToCols(input.storageScope)
    const rows = yield* sql<{ readonly key: string }>`
      SELECT key
      FROM extension_storage_items
      WHERE extension_id = ${input.extensionId}
        AND package_scope_kind = ${packageScope.kind}
        AND package_scope_id = ${packageScope.id}
        AND storage_kind = ${input.storageKind}
        AND storage_scope_kind = ${storageScope.kind}
        AND storage_scope_id = ${storageScope.id}
      ORDER BY key ASC
    `
    return rows.map((row) => row.key)
  }).pipe(Effect.mapError((cause) => repoErr('listKeys', cause)))
}

export const SqliteExtensionStorageRepositoryLive = Layer.effect(
  ExtensionStorageRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    return ExtensionStorageRepository.of({
      get: (key) => getItem(sql, key),
      upsert: (item) => upsertItem(sql, item),
      delete: (key) => deleteItem(sql, key),
      listKeys: (input) => listKeys(sql, input),
    })
  }),
)
