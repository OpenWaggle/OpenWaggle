import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  USAGE_STATISTICS_ERROR_TUNNEL_PATH,
  USAGE_STATISTICS_EVENTS_PATH,
  USAGE_STATISTICS_ORIGIN,
  USAGE_STATISTICS_SNAPSHOT_PATH,
  USAGE_STATISTICS_WEB_PATH,
} from '../../../src/shared/usage-statistics/contract'
import { onRequest } from '../../api/v1/[[path]]'
import { STATISTICS_ROUTE_PATHS } from '../request-log'
import { USAGE_STATS_FLUSH_PATH } from '../snapshot-contract'
import { WEB_BEACON_PATH, WEB_PRODUCTION_HOSTNAME } from '../web-beacon-contract'
import { backgroundTasks, eventsBody, runFinished, statisticsRequest } from './test-support'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('statistics endpoint deployment', () => {
  it("serves the paths the shared contract publishes, and the snapshot job's flush", () => {
    expect(Object.values(STATISTICS_ROUTE_PATHS).sort()).toEqual(
      [
        USAGE_STATISTICS_EVENTS_PATH,
        USAGE_STATISTICS_ERROR_TUNNEL_PATH,
        USAGE_STATISTICS_WEB_PATH,
        USAGE_STATISTICS_SNAPSHOT_PATH,
        USAGE_STATS_FLUSH_PATH,
      ].sort(),
    )
  })

  it("keeps the website beacon contract on the contract's origin and path", () => {
    expect(WEB_BEACON_PATH).toBe(USAGE_STATISTICS_WEB_PATH)
    expect(new URL(USAGE_STATISTICS_ORIGIN).hostname).toBe(WEB_PRODUCTION_HOSTNAME)
  })

  it('adapts the Pages context to the endpoint with the runtime dependencies', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const fetch = vi.spyOn(globalThis, 'fetch')
    const background = backgroundTasks()
    const request = statisticsRequest('/api/v1/events', {
      body: eventsBody([runFinished()]),
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await onRequest({ request, env: {}, ...background.tasks })
    await background.settle()

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'STATS_KV is not bound' })
    expect(log).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      path: '/api/v1/events',
      outcome: 'skipped',
    })
    expect(fetch).not.toHaveBeenCalled()
  })
})
