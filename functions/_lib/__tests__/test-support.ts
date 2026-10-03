import type {
  BackgroundTasks,
  IncomingRequest,
  KeyValueListOptions,
  KeyValueListResult,
  KeyValuePutOptions,
  KeyValueStore,
} from '../cloudflare'
import type { StatisticsDependencies } from '../dependencies'
import type { StatisticsEnvironment } from '../environment'
import { STATISTICS_ROUTE_PATHS } from '../request-log'
import type { RouteContext } from '../route-context'

/** 2026-10-02 15:30 UTC: the endpoint's clock in every test. */
export const NOW = Date.parse('2026-10-02T15:30:00.000Z')
export const TODAY = '2026-10-02'
export const YESTERDAY = '2026-10-01'
export const POSTHOG_KEY = 'phc_test_project_key'
export const SNAPSHOT_TOKEN = 'snapshot-token-0123456789'
export const CLIENT_ADDRESS = '203.0.113.77'
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15'

export const PERSONLESS = {
  distinct_id: 'openwaggle-anonymous',
  $process_person_profile: false,
  $geoip_disable: true,
  $lib: 'openwaggle-statistics-endpoint',
  $lib_version: '1',
}

export const CONTEXT = {
  version: '1.0.0-beta.4',
  build_channel: 'beta',
  update_channel: 'beta',
  os: 'darwin',
  arch: 'arm64',
} as const

/** The absolute KV expiry of buffered entries of `day`: 45 days after the day ends. */
export function bufferExpiry(day: string) {
  return Date.parse(`${day}T00:00:00Z`) / 1000 + 46 * 86_400
}

export function runFinished(properties: Record<string, unknown> = {}, day = YESTERDAY) {
  return {
    name: 'run.finished',
    day,
    properties: {
      entry_point: 'app',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      thinking_level: 'high',
      access_mode: 'yolo',
      waggle: false,
      result: 'completed',
      duration_s: 42,
      input_tokens: 1200,
      output_tokens: 340,
      ...properties,
    },
  }
}

export function eventsBody(events: readonly unknown[], context: unknown = CONTEXT) {
  return JSON.stringify({ schema: 1, context, events })
}

/** A clock that moves only when something sleeps, shared by a job, the endpoint and KV. */
export class FakeClock {
  private time: number

  constructor(start = NOW) {
    this.time = start
  }

  readonly now = () => this.time

  readonly sleep = async (milliseconds: number) => {
    this.time += milliseconds
  }
}

interface MemoryStoreOptions {
  /**
   * Refuses, with a 429 like KV's, a second write or delete of one key within a second of the
   * clock it reads.
   */
  readonly oneWritePerKeyPerSecond?: () => number
  /** Deleted keys stay listed, as KV's eventually consistent lists can return them for a minute. */
  readonly staleListing?: boolean
  /** The first page of every listing is empty but incomplete, which KV allows. */
  readonly emptyFirstPage?: boolean
  /** Keys a page holds at most, whatever the caller asks for. */
  readonly pageSize?: number
}

/**
 * Workers KV in memory, keeping the options of every write. Deletes of keys in `failingDeletes`
 * and writes of keys in `failingPuts` throw, as during a KV incident.
 */
export class MemoryKeyValueStore implements KeyValueStore {
  readonly entries = new Map<string, { value: string; options?: KeyValuePutOptions }>()
  readonly writes: string[] = []
  readonly deletes: string[] = []
  readonly failingDeletes = new Set<string>()
  readonly failingPuts = new Set<string>()
  readonly lists: KeyValueListOptions[] = []
  /** Every get, put, delete and list, as Workers count KV operations. */
  operations = 0
  /** Writes and deletes refused for coming within a second of the last one to their key. */
  readonly refusedWrites: string[] = []
  private readonly deletedButListed = new Set<string>()
  private readonly lastWrite = new Map<string, number>()

  constructor(private readonly options: MemoryStoreOptions = {}) {}

  async get(key: string) {
    this.operations += 1
    return this.entries.get(key)?.value ?? null
  }

  /** Throws like KV when `key` was written less than a second ago. */
  private checkWriteRate(key: string) {
    const clock = this.options.oneWritePerKeyPerSecond
    if (clock === undefined) return
    const now = clock()
    const last = this.lastWrite.get(key)
    if (last !== undefined && now - last < 1000) {
      this.refusedWrites.push(key)
      throw new Error('KV PUT failed: 429 Too Many Requests')
    }
    this.lastWrite.set(key, now)
  }

  async put(key: string, value: string, options?: KeyValuePutOptions) {
    this.operations += 1
    this.checkWriteRate(key)
    if (this.failingPuts.has(key)) throw new Error('KV write failed')
    this.writes.push(key)
    this.entries.set(key, options === undefined ? { value } : { value, options })
  }

  async delete(key: string) {
    this.operations += 1
    this.checkWriteRate(key)
    if (this.failingDeletes.has(key)) throw new Error('KV delete failed')
    this.deletes.push(key)
    this.entries.delete(key)
    if (this.options.staleListing === true) this.deletedButListed.add(key)
  }

  async list(options: KeyValueListOptions = {}): Promise<KeyValueListResult> {
    this.operations += 1
    this.lists.push(options)
    const prefix = options.prefix ?? ''
    const names = [...new Set([...this.entries.keys(), ...this.deletedButListed])]
      .filter((name) => name.startsWith(prefix))
      .sort()
    if (this.options.emptyFirstPage === true && options.cursor === undefined) {
      return { keys: [], list_complete: false, cursor: '0' }
    }
    const start = Number(options.cursor ?? '0')
    const limit = Math.min(options.limit ?? 1000, this.options.pageSize ?? 1000)
    const end = start + limit
    const keys = names.slice(start, end).map((name) => ({ name }))
    if (end >= names.length) return { keys, list_complete: true }
    return { keys, list_complete: false, cursor: String(end) }
  }

  /** Stored values under `prefix`, parsed. */
  values(prefix: string): unknown[] {
    return [...this.entries.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, entry]) => JSON.parse(entry.value))
  }
}

/** A KV namespace whose every call fails, as during a KV outage. */
export function failingStore(): KeyValueStore {
  const fail = () => Promise.reject(new Error('KV is unavailable'))
  return { get: fail, put: fail, delete: fail, list: fail }
}

export interface RecordedRequest {
  readonly url: string
  readonly init: RequestInit
}

export type Responder = (url: string, init: RequestInit) => Response | Promise<Response>

export function testUuid(index: number) {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
}

export function testDependencies(
  respond: Responder = () => new Response('{"status":1}'),
  clock?: FakeClock,
) {
  const requests: RecordedRequest[] = []
  const lines: string[] = []
  const sleeps: number[] = []
  let uuids = 0
  const dependencies: StatisticsDependencies = {
    fetch: async (url, init) => {
      requests.push({ url, init })
      return respond(url, init)
    },
    now: clock?.now ?? (() => NOW),
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds)
      await clock?.sleep(milliseconds)
    },
    randomBytes: (length) => new Uint8Array(length).fill(7),
    randomId: () => 'a'.repeat(32),
    randomUuid: () => {
      uuids += 1
      return testUuid(uuids)
    },
    log: (line) => {
      lines.push(line)
    },
  }
  return { dependencies, requests, lines, sleeps }
}

export function environment(overrides: Partial<StatisticsEnvironment> = {}): StatisticsEnvironment {
  return { POSTHOG_PROJECT_KEY: POSTHOG_KEY, ...overrides }
}

export function statisticsRequest(
  path: string,
  init: RequestInit & { readonly cf?: unknown; readonly origin?: string } = {},
): IncomingRequest {
  const { cf, origin = 'https://openwaggle.ai', ...requestInit } = init
  return Object.assign(new Request(`${origin}${path}`, { method: 'POST', ...requestInit }), { cf })
}

/** What a route handler receives, as the endpoint builds it for `request`. */
export function routeContext(
  request: IncomingRequest,
  env: StatisticsEnvironment,
  dependencies: StatisticsDependencies,
): RouteContext {
  const pathname = new URL(request.url).pathname
  const path = Object.values(STATISTICS_ROUTE_PATHS).find((candidate) => candidate === pathname)
  if (path === undefined) throw new Error(`no route serves ${pathname}`)
  return { request, environment: env, dependencies, path, startedAt: NOW }
}

export function backgroundTasks() {
  const pending: Promise<unknown>[] = []
  const tasks: BackgroundTasks = {
    waitUntil: (promise) => {
      pending.push(promise)
    },
  }
  return { tasks, settle: () => Promise.all(pending) }
}

export function jsonBody(init: RequestInit) {
  if (typeof init.body !== 'string') throw new Error('expected a string body')
  return JSON.parse(init.body)
}

/** The `batch` of a PostHog batch request. */
export function postHogBatch(request: RecordedRequest | undefined) {
  if (request === undefined) throw new Error('expected a PostHog request')
  const body = jsonBody(request.init)
  return { apiKey: body.api_key, events: body.batch }
}
