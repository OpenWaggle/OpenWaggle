import { expect } from 'vitest'
import type { KeyValueStore } from '../cloudflare'
import { handleEventsRequest } from '../events-route'
import {
  environment,
  MemoryKeyValueStore,
  routeContext,
  statisticsRequest,
  testDependencies,
  YESTERDAY,
} from './test-support'

export interface SendOptions {
  readonly store?: KeyValueStore
  readonly headers?: Record<string, string>
  readonly cf?: unknown
  readonly env?: Record<string, unknown>
}

export async function send(body: BodyInit, options: SendOptions = {}) {
  const store = options.store ?? new MemoryKeyValueStore()
  const test = testDependencies()
  const request = statisticsRequest('/api/v1/events', {
    body,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    cf: 'cf' in options ? options.cf : { country: 'DE' },
  })
  const env = environment({ STATS_KV: store, ...options.env })
  const result = await handleEventsRequest(routeContext(request, env, test.dependencies))
  return { ...test, result, store, response: await result.response.json() }
}

export function onlyEntry(store: KeyValueStore) {
  if (!(store instanceof MemoryKeyValueStore)) throw new Error('expected a memory store')
  expect(store.entries.size).toBe(1)
  const [[key, stored]] = [...store.entries.entries()]
  return { key, options: stored?.options, entry: JSON.parse(stored?.value ?? '{}') }
}

export function requestRows(outcome: string, status: number, extra: unknown[][] = []) {
  return [
    ['endpoint.requests', '_count', '1', 1],
    ['endpoint.requests', 'path', '/api/v1/events', 1],
    ['endpoint.requests', 'outcome', outcome, 1],
    ['endpoint.requests', 'status', String(status), 1],
    ['endpoint.requests', 'latency', '<50ms', 1],
    ...extra,
  ]
}

export const ACTIVE_DAY = {
  name: 'install.active',
  day: YESTERDAY,
  properties: {
    first_this_week: true,
    first_this_month: false,
    install_age: '8-30d',
    entry_points: ['app', 'cli'],
    worktree: true,
    mcp_servers: ['playwright'],
    skills: ['visualize'],
    extensions_enabled: '1',
  },
}
