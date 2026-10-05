/**
 * Whether this process owns the app database or is an attached GUI with an isolated, empty one.
 * Kept free of Electron and SQLite so the settings store can read it.
 */
export type AppDatabaseAccess = 'owner' | 'client-isolated'

let configuredAccess: AppDatabaseAccess = 'owner'

/** Called only by `configureAppDatabaseAccess`, which guards against late changes. */
export function setAppDatabaseAccessMode(access: AppDatabaseAccess) {
  configuredAccess = access
}

export function isAppDatabaseClientIsolated() {
  return configuredAccess === 'client-isolated'
}
