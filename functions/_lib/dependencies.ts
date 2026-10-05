import type { OutboundFetch } from './cloudflare'

/** Everything the endpoint takes from its runtime, injectable so tests stay deterministic. */
export interface StatisticsDependencies {
  readonly fetch: OutboundFetch
  readonly now: () => number
  readonly randomBytes: (length: number) => Uint8Array
  /** A random 32-character hex id, as Sentry expects for `event_id`. */
  readonly randomId: () => string
  /** A random RFC 4122 UUID, for buffer keys and aggregated PostHog records. */
  readonly randomUuid: () => string
  /** Writes one structured log line; Cloudflare's live log stream shows it. */
  readonly log: (line: string) => void
  /** Waits; Workers bill CPU time, not the time spent waiting. */
  readonly sleep: (milliseconds: number) => Promise<void>
}

const UUID_SEPARATORS = /-/gu

/**
 * The Workers runtime implementations. `fetch` and `crypto` are wrapped in arrows because the
 * runtime rejects them when they are called detached from `globalThis`.
 */
export function runtimeDependencies(): StatisticsDependencies {
  return {
    fetch: (url, init) => fetch(url, init),
    now: () => Date.now(),
    randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
    randomId: () => crypto.randomUUID().replace(UUID_SEPARATORS, ''),
    randomUuid: () => crypto.randomUUID(),
    log: (line) => console.log(line),
    sleep: (milliseconds) =>
      new Promise((resolve) => {
        setTimeout(resolve, milliseconds)
      }),
  }
}
