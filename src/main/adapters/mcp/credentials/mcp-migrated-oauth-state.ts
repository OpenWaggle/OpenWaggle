/**
 * The merged sign-in states with a migrated pre-ADR-0050 sign-in added under Pi's `key`, or
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
