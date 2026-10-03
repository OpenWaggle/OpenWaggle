/** Shared fakes for the snapshot job's unit tests: GitHub, npm and the endpoint, by URL. */
import {
  DEFAULT_SNAPSHOT_URL,
  type SnapshotJobEnvironment,
} from '../usage-stats-snapshot-endpoint'

export const RELEASES_URL = 'https://api.github.com/repos/OpenWaggle/OpenWaggle/releases?per_page=100'
export const RELEASES_PAGE_2 = 'https://api.github.com/repositories/1/releases?per_page=100&page=2'
export const TRAFFIC = 'https://api.github.com/repos/OpenWaggle/OpenWaggle/traffic'
export const NPM = 'https://api.npmjs.org/downloads/range/last-month'
export const FLUSH_URL = 'https://openwaggle.ai/api/v1/flush'

export function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, ...init })
}

export function release(tag: string, assets: readonly [number, string, number][], draft = false) {
  return { tag_name: tag, draft, html_url: 'x', assets: assets.map(([id, name, download_count]) => ({ id, name, download_count, size: 1 })) }
}

export const ROUTES: Record<string, () => Response> = {
  [RELEASES_URL]: () =>
    json([release('v1.0.0-beta.4', [[1, 'alpha-mac.yml', 9], [2, 'openwaggle-1.0.0-beta.4-x64.exe', 0]])], {
      headers: { Link: `<${RELEASES_PAGE_2}>; rel="next", <${RELEASES_PAGE_2}>; rel="last"` },
    }),
  [RELEASES_PAGE_2]: () =>
    json([release('v0.4.0-alpha.7', [[3, 'SHA256SUMS.txt', 2]]), release('v9.9.9', [[4, 'x.dmg', 5]], true)]),
  [`${TRAFFIC}/views?per=day`]: () =>
    json({ count: 3, uniques: 2, views: [{ timestamp: '2026-10-01T00:00:00Z', count: 3, uniques: 2 }] }),
  [`${TRAFFIC}/clones?per=day`]: () => json({ count: 0, uniques: 0, clones: [] }),
  [`${TRAFFIC}/popular/referrers`]: () => json([{ referrer: 'news.ycombinator.com', count: 4, uniques: 3 }]),
  [`${TRAFFIC}/popular/paths`]: () =>
    json([{ path: '/OpenWaggle/OpenWaggle', title: 'OpenWaggle', count: 8, uniques: 6 }]),
  [`${NPM}/@openwaggle/extension-sdk`]: () =>
    json({ package: '@openwaggle/extension-sdk', downloads: [{ day: '2026-09-30', downloads: 4 }] }),
  [`${NPM}/@openwaggle/extension-react`]: () => json({ error: 'not found' }, { status: 404 }),
  [`${NPM}/@openwaggle/waggle-core`]: () => json({ downloads: [] }),
  [`${NPM}/@openwaggle/pi-waggle`]: () => json({ downloads: [{ day: '2026-09-30', downloads: 1 }] }),
  [DEFAULT_SNAPSHOT_URL]: () => json({ events: 5 }, { status: 202 }),
  [FLUSH_URL]: () => json({ processed: 0, remaining: 0, held: 0, discarded: 0, undeleted: 0 }),
}

/** A route answering each call with the next response, repeating the last one. */
export function sequence(...responses: (() => Response)[]) {
  let call = 0
  return () => {
    const respond = responses[Math.min(call, responses.length - 1)]
    call += 1
    if (respond === undefined) throw new Error('expected a response')
    return respond()
  }
}

export function job(
  env: SnapshotJobEnvironment,
  overrides: Record<string, () => Response> = {},
  callMilliseconds = 0,
) {
  const requests: { url: string; init: RequestInit }[] = []
  const lines: string[] = []
  const pauses: number[] = []
  const routes = { ...ROUTES, ...overrides }
  let time = 0
  return {
    requests,
    lines,
    pauses,
    options: {
      env,
      log: (line: string) => {
        lines.push(line)
      },
      fetch: async (url: string, init: RequestInit) => {
        requests.push({ url, init })
        time += callMilliseconds
        const route = routes[url]
        if (route === undefined) throw new Error(`unexpected request to ${url}`)
        return route()
      },
      sleep: async (milliseconds: number) => {
        pauses.push(milliseconds)
        time += milliseconds
      },
      now: () => time,
    },
  }
}

export const FULL_ENV = {
  STATS_SNAPSHOT_TOKEN: 'snapshot-token',
  STATS_GITHUB_TOKEN: 'traffic-token',
  GITHUB_TOKEN: 'workflow-token',
}
