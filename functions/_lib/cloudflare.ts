/**
 * The few Cloudflare Pages Function types the statistics endpoint uses. They are declared here
 * instead of depending on `@cloudflare/workers-types`, and describe only what the code calls.
 */

/** Options of `KVNamespace.put` that the endpoint uses. */
export interface KeyValuePutOptions {
  /** Absolute expiry in seconds since the Unix epoch, at least 60 seconds ahead. */
  readonly expiration?: number
  /** Expiry in seconds from now, at least 60. */
  readonly expirationTtl?: number
}

/** Options of `KVNamespace.list` that the endpoint uses. */
export interface KeyValueListOptions {
  readonly prefix?: string
  /** At most 1000; KV may return fewer keys, even none, while more exist. */
  readonly limit?: number
  /** The `cursor` of the previous page, to read the next one. */
  readonly cursor?: string
}

export interface KeyValueListResult {
  readonly keys: readonly { readonly name: string }[]
  /** `false` when more keys may follow; `cursor` then reads the next page. */
  readonly list_complete: boolean
  readonly cursor?: string
}

/**
 * The part of a Workers KV namespace binding the endpoint calls. KV is eventually consistent:
 * a write or delete can take up to a minute to reach every location, and `list` can briefly
 * return keys that were just deleted.
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: KeyValuePutOptions): Promise<void>
  delete(key: string): Promise<void>
  list(options?: KeyValueListOptions): Promise<KeyValueListResult>
}

/**
 * An incoming Pages request. Cloudflare attaches its request metadata as `cf`; the endpoint
 * reads only `cf.country` and validates it, because the object is absent in local runs.
 */
export type IncomingRequest = Request & { readonly cf?: unknown }

/** Work that may finish after the response is sent, like `EventContext.waitUntil`. */
export interface BackgroundTasks {
  waitUntil(promise: Promise<unknown>): void
}

/** Outbound `fetch`, injectable so tests never reach the network. */
export type OutboundFetch = (url: string, init: RequestInit) => Promise<Response>
