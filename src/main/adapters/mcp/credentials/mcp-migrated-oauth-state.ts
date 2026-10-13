import type { McpOAuthStorageBackend } from './mcp-oauth-state-backend'

/**
 * The merged sign-in states with a migrated pre-ADR-0051 sign-in added under Pi's `key`, or
 * undefined when that key already has one: a sign-in made since (in Settings, or with Pi's CLI,
 * whose `mcp-auth.json` the merged states include) is newer than the old one.
 */
export function withMigratedOAuthState(current: string | undefined, key: string, state: unknown) {
  const parsed: unknown = current === undefined ? {} : JSON.parse(current)
  const states: Record<string, unknown> =
    typeof parsed === 'object' && parsed !== null ? { ...parsed } : {}
  if (states[key] !== undefined) return undefined
  return JSON.stringify({ ...states, [key]: state })
}

/**
 * Moves a migrated sign-in into the sign-in store: false when the key already has one. Throws when
 * the store can only keep it in memory (operating-system encryption unavailable), so the migration
 * reports a failure and tries again instead of recording a sign-in that is gone after a restart.
 */
export function writeMigratedOAuthState(
  backend: Pick<McpOAuthStorageBackend, 'withLock' | 'persistsWrites'>,
  key: string,
  state: unknown,
) {
  if (!backend.persistsWrites()) {
    throw new Error(
      'Operating-system encryption is unavailable, so the old MCP sign-in cannot be saved yet.',
    )
  }
  return backend.withLock((current) => {
    const next = withMigratedOAuthState(current, key, state)
    return next === undefined ? { result: false } : { result: true, next }
  })
}
