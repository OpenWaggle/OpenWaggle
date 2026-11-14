import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionPackageScope } from '../extensions/types'
import { SQLITE_BOOLEAN } from '../services/database-constants'

export function booleanToSqlite(value: boolean) {
  return value ? SQLITE_BOOLEAN.TRUE : SQLITE_BOOLEAN.FALSE
}

export function sqliteToBoolean(value: number) {
  return value === SQLITE_BOOLEAN.TRUE
}

/** The `scope_kind` and `scope_id` columns that store an extension package scope. */
export function scopeToColumns(scope: ExtensionPackageScope) {
  return scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND
    ? {
        scopeKind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND,
        scopeId: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_ID,
      }
    : { scopeKind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, scopeId: scope.projectPath }
}

/**
 * Reads an extension package scope back from its columns. `recordName` names the stored record
 * in the error for an unknown scope kind.
 */
export function scopeFromColumns(scopeKind: string, scopeId: string, recordName: string) {
  if (scopeKind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND) {
    return { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND }
  }
  if (scopeKind === OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND) {
    return { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: scopeId }
  }
  throw new Error(`Unknown ${recordName} scope kind "${scopeKind}".`)
}
