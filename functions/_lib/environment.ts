import type { KeyValueStore } from './cloudflare'

/**
 * Bindings and settings of the statistics endpoint. Every one is optional, so a missing one
 * never fails the deployment; what each route does without it is listed in wrangler.toml.
 *
 * - `POSTHOG_PROJECT_KEY` (secret): PostHog project API key.
 * - `POSTHOG_HOST`: PostHog ingestion host. Only `https://eu.i.posthog.com`, the default, is
 *   accepted; any other value turns forwarding off (ADR 0045).
 * - `SENTRY_DSN` (secret): the real Sentry DSN behind the error-report tunnel. Only a project
 *   in Sentry's EU region (`*.de.sentry.io`) is accepted.
 * - `STATS_SNAPSHOT_TOKEN` (secret): bearer token of the daily snapshot and flush.
 * - `STATS_KV`: KV namespace for buffered statistics, the daily website salt and the snapshot's
 *   last forwarded totals.
 */
export interface StatisticsEnvironment {
  readonly POSTHOG_PROJECT_KEY?: string
  readonly POSTHOG_HOST?: string
  readonly SENTRY_DSN?: string
  readonly STATS_SNAPSHOT_TOKEN?: string
  readonly STATS_KV?: KeyValueStore
}

/** Returns a trimmed string setting, or `undefined` when it is missing, blank or not a string. */
export function configuredValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

const KEY_VALUE_METHODS = ['get', 'put', 'delete', 'list'] as const

function isKeyValueStore(value: unknown): value is KeyValueStore {
  if (typeof value !== 'object' || value === null) return false
  return KEY_VALUE_METHODS.every((method) => typeof Reflect.get(value, method) === 'function')
}

/** The `STATS_KV` binding, or `undefined` when the namespace is not bound. */
export function statisticsStore(environment: StatisticsEnvironment) {
  const store: unknown = environment.STATS_KV
  return isKeyValueStore(store) ? store : undefined
}
