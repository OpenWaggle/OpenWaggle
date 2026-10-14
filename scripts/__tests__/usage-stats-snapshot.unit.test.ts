import { describe, expect, it } from 'vitest'
import { validateUsageStatsSnapshot } from '../../functions/_lib/snapshot-contract'
import { collectUsageStatsSnapshot, runUsageStatsSnapshot } from '../usage-stats-snapshot'
import { DEFAULT_SNAPSHOT_URL } from '../usage-stats-snapshot-endpoint'
import {
  FLUSH_URL,
  FULL_ENV,
  failingBody,
  job,
  json,
  NPM,
  networkError,
  RELEASES_PAGE_2,
  RELEASES_URL,
  TRAFFIC,
  throws,
  timeoutError,
} from './usage-stats-snapshot-test-support'

describe('usage statistics snapshot job', () => {
  it('collects every release page, traffic and npm downloads into a valid snapshot', async () => {
    const { options, lines } = job(FULL_ENV)
    const snapshot = await collectUsageStatsSnapshot(options)

    expect(snapshot).toEqual({
      schema: 1,
      releases: [
        { tag: 'v1.0.0-beta.4', assets: [{ id: 1, name: 'alpha-mac.yml', download_count: 9 }] },
        { tag: 'v0.4.0-alpha.7', assets: [{ id: 3, name: 'SHA256SUMS.txt', download_count: 2 }] },
      ],
      traffic: {
        views: [{ day: '2026-10-01', count: 3, uniques: 2 }],
        clones: [],
        referrers: [{ name: 'news.ycombinator.com', count: 4, uniques: 3 }],
        paths: [{ name: '/OpenWaggle/OpenWaggle', count: 8, uniques: 6 }],
      },
      npm: [
        { name: '@openwaggle/extension-sdk', days: [{ day: '2026-09-30', downloads: 4 }] },
        { name: '@openwaggle/waggle-core', days: [] },
        { name: '@openwaggle/pi-waggle', days: [{ day: '2026-09-30', downloads: 1 }] },
      ],
    })
    expect(validateUsageStatsSnapshot(snapshot)).toEqual({ ok: true, value: snapshot })
    expect(lines).toContain('::warning::npm downloads for @openwaggle/extension-react answered 404; skipped.')
  })

  it('reads releases with the workflow token and only traffic with the traffic token', async () => {
    const { options, requests } = job(FULL_ENV)
    await collectUsageStatsSnapshot(options)

    const authorization = (url: string) =>
      new Headers(requests.find((request) => request.url === url)?.init.headers).get('Authorization')
    expect(authorization(RELEASES_URL)).toBe('Bearer workflow-token')
    expect(authorization(RELEASES_PAGE_2)).toBe('Bearer workflow-token')
    expect(authorization(`${TRAFFIC}/views?per=day`)).toBe('Bearer traffic-token')
    expect(authorization(`${NPM}/@openwaggle/pi-waggle`)).toBeNull()
  })

  it('still reads releases when the traffic token has expired', async () => {
    const expired = () => json({ message: 'Bad credentials' }, { status: 401 })
    const { options, lines } = job(FULL_ENV, {
      [`${TRAFFIC}/views?per=day`]: expired,
      [`${TRAFFIC}/clones?per=day`]: expired,
      [`${TRAFFIC}/popular/referrers`]: expired,
      [`${TRAFFIC}/popular/paths`]: expired,
    })
    const snapshot = await collectUsageStatsSnapshot(options)

    expect(snapshot.traffic).toBeNull()
    expect(snapshot.releases).toHaveLength(2)
    expect(lines.some((line) => line.startsWith('::warning::GitHub traffic answered 401'))).toBe(true)
  })

  it('skips traffic without STATS_GITHUB_TOKEN and never calls the traffic API', async () => {
    const { options, requests, lines } = job({ STATS_SNAPSHOT_TOKEN: 'snapshot-token' })
    const snapshot = await collectUsageStatsSnapshot(options)

    expect(snapshot.traffic).toBeNull()
    expect(requests.some((request) => request.url.startsWith(TRAFFIC))).toBe(false)
    expect(lines).toContain('STATS_GITHUB_TOKEN is not set; the snapshot carries no repository traffic.')
  })

  it('skips traffic with a warning when the token may not read it', async () => {
    const forbidden = () => json({ message: 'Resource not accessible' }, { status: 403 })
    const { options, lines } = job(FULL_ENV, { [`${TRAFFIC}/popular/paths`]: forbidden })
    const snapshot = await collectUsageStatsSnapshot(options)

    expect(snapshot.traffic).toBeNull()
    expect(lines.some((line) => line.startsWith('::warning::GitHub traffic answered 403'))).toBe(true)
  })

  it('skips npm packages npm cannot serve, and keeps the rest of the snapshot', async () => {
    const { options, lines } = job(FULL_ENV, {
      [`${NPM}/@openwaggle/extension-sdk`]: throws(timeoutError()),
      [`${NPM}/@openwaggle/extension-react`]: throws(networkError('ECONNRESET')),
      [`${NPM}/@openwaggle/waggle-core`]: failingBody(timeoutError()),
      [`${NPM}/@openwaggle/pi-waggle`]: () => new Response('<html>Bad gateway</html>', { status: 200 }),
    })
    const snapshot = await collectUsageStatsSnapshot(options)

    expect(snapshot.releases).toHaveLength(2)
    expect(snapshot.npm).toEqual([])
    expect(validateUsageStatsSnapshot(snapshot)).toEqual({ ok: true, value: snapshot })
    const skipped = (name: string) => lines.find((line) => line.startsWith(`::warning::npm downloads for ${name} `))
    expect(skipped('@openwaggle/extension-sdk')).toBe(
      '::warning::npm downloads for @openwaggle/extension-sdk could not be read (The operation was aborted due to timeout); skipped.',
    )
    expect(skipped('@openwaggle/extension-react')).toBe(
      '::warning::npm downloads for @openwaggle/extension-react could not be read (fetch failed: ECONNRESET); skipped.',
    )
    expect(skipped('@openwaggle/waggle-core')).toBe(
      '::warning::npm downloads for @openwaggle/waggle-core could not be read (The operation was aborted due to timeout); skipped.',
    )
    expect(skipped('@openwaggle/pi-waggle')).toMatch(/^::warning::npm downloads for @openwaggle\/pi-waggle could not be read \(.+\); skipped\.$/u)
  })

  it('skips an npm answer of an unexpected shape without calling it a status', async () => {
    const { options, lines } = job(FULL_ENV, { [`${NPM}/@openwaggle/pi-waggle`]: () => json({ error: 'gone' }) })
    const snapshot = await collectUsageStatsSnapshot(options)

    expect(snapshot.npm.map(({ name }) => name)).not.toContain('@openwaggle/pi-waggle')
    expect(lines).toContain('::warning::npm downloads for @openwaggle/pi-waggle returned an unexpected shape; skipped.')
  })

  it('still sends the release statistics when every npm request times out', async () => {
    const { options, requests } = job(FULL_ENV, {
      [`${NPM}/@openwaggle/extension-sdk`]: throws(timeoutError()),
      [`${NPM}/@openwaggle/extension-react`]: throws(timeoutError()),
      [`${NPM}/@openwaggle/waggle-core`]: throws(timeoutError()),
      [`${NPM}/@openwaggle/pi-waggle`]: throws(timeoutError()),
    })
    await runUsageStatsSnapshot({ ...options, dryRun: false })

    const posted: unknown = JSON.parse(String(requests.find((request) => request.url === DEFAULT_SNAPSHOT_URL)?.init.body))
    expect(validateUsageStatsSnapshot(posted).ok).toBe(true)
    expect(posted).toMatchObject({ npm: [], releases: [{ tag: 'v1.0.0-beta.4' }, { tag: 'v0.4.0-alpha.7' }] })
  })

  it('carries no traffic, and keeps the releases, when a traffic request times out or its body fails', async () => {
    for (const failure of [throws(timeoutError()), failingBody(networkError('UND_ERR_SOCKET'))]) {
      const { options, lines } = job(FULL_ENV, { [`${TRAFFIC}/clones?per=day`]: failure })
      const snapshot = await collectUsageStatsSnapshot(options)

      expect(snapshot.traffic).toBeNull()
      expect(snapshot.releases).toHaveLength(2)
      expect(snapshot.npm).toHaveLength(3)
      expect(lines.some((line) => line.startsWith('::warning::GitHub traffic could not be read ('))).toBe(true)
    }
  })

  it('blames the token only when GitHub refuses it', async () => {
    const unavailable = job(FULL_ENV, { [`${TRAFFIC}/views?per=day`]: () => json({}, { status: 503 }) })
    expect((await collectUsageStatsSnapshot(unavailable.options)).traffic).toBeNull()
    expect(unavailable.lines).toContain('::warning::GitHub traffic answered 503; the snapshot carries no traffic.')

    const forbidden = job(FULL_ENV, { [`${TRAFFIC}/views?per=day`]: () => json({}, { status: 403 }) })
    await collectUsageStatsSnapshot(forbidden.options)
    expect(forbidden.lines).toContain(
      '::warning::GitHub traffic answered 403; the snapshot carries no traffic. STATS_GITHUB_TOKEN needs Administration: read.',
    )
  })

  it('still fails on a traffic answer of an unexpected shape', async () => {
    const { options } = job(FULL_ENV, { [`${TRAFFIC}/views?per=day`]: () => json({ views: 'none' }) })
    await expect(collectUsageStatsSnapshot(options)).rejects.toThrow('GitHub traffic returned an unexpected shape.')
  })

  it('fails when a GitHub releases request times out', async () => {
    const { options } = job(FULL_ENV, { [RELEASES_URL]: throws(timeoutError()) })
    await expect(collectUsageStatsSnapshot(options)).rejects.toThrow('The operation was aborted due to timeout')
  })

  it('fails when GitHub releases cannot be read', async () => {
    const { options } = job(FULL_ENV, { [RELEASES_URL]: () => json({}, { status: 500 }) })
    await expect(collectUsageStatsSnapshot(options)).rejects.toThrow('GitHub releases answered 500.')
  })

  it('posts the snapshot to the endpoint with the bearer token, then flushes', async () => {
    const { options, requests, lines } = job(FULL_ENV)
    await runUsageStatsSnapshot({ ...options, dryRun: false })

    const post = requests.find((request) => request.url === DEFAULT_SNAPSHOT_URL)
    expect(post?.init.method).toBe('POST')
    expect(new Headers(post?.init.headers).get('Authorization')).toBe('Bearer snapshot-token')
    expect(validateUsageStatsSnapshot(JSON.parse(String(post?.init.body))).ok).toBe(true)
    expect(lines).toContain('Snapshot endpoint: {"events":5}')
    const flush = requests.find((request) => request.url === FLUSH_URL)
    expect(new Headers(flush?.init.headers).get('Authorization')).toBe('Bearer snapshot-token')
    expect(lines.join('\n')).not.toContain('snapshot-token')
  })

  it('prints the snapshot instead of posting it in a dry run', async () => {
    const { options, requests, lines } = job({})
    await runUsageStatsSnapshot({ ...options, dryRun: true })

    expect(requests.some((request) => request.url === DEFAULT_SNAPSHOT_URL)).toBe(false)
    expect(JSON.parse(lines.at(-1) ?? '')).toMatchObject({ schema: 1, traffic: null })
  })

  it('does nothing, successfully, without STATS_SNAPSHOT_TOKEN', async () => {
    const { options, requests, lines } = job({ GITHUB_TOKEN: 'workflow-token' })
    await runUsageStatsSnapshot({ ...options, dryRun: false })

    expect(requests).toEqual([])
    expect(lines).toEqual(['::notice::STATS_SNAPSHOT_TOKEN is not set; skipping the usage statistics snapshot.'])
  })

  it('fails with the endpoint status when the endpoint refuses the snapshot', async () => {
    const refused = () => json({ error: 'invalid token' }, { status: 401 })
    const { options } = job(FULL_ENV, { [DEFAULT_SNAPSHOT_URL]: refused })

    await expect(runUsageStatsSnapshot({ ...options, dryRun: false })).rejects.toThrow(
      'The snapshot failed: Endpoint /api/v1/snapshot answered 401: {"error":"invalid token"}',
    )
  })

  it('warns without failing while the endpoint is not configured, and still flushes', async () => {
    const skipped = () => json({ skipped: 'STATS_KV is not bound' }, { status: 503 })
    const { options, requests, lines } = job(FULL_ENV, {
      [DEFAULT_SNAPSHOT_URL]: skipped,
      [FLUSH_URL]: skipped,
    })
    await runUsageStatsSnapshot({ ...options, dryRun: false })

    expect(lines).toContain('::warning::The endpoint stored nothing: STATS_KV is not bound.')
    expect(lines.at(-1)).toBe('::warning::The endpoint flushed nothing: STATS_KV is not bound.')
    expect(requests.some((request) => request.url === FLUSH_URL)).toBe(true)
  })

  it('posts to STATS_SNAPSHOT_URL when it is set, and flushes on the same origin', async () => {
    const local = 'http://localhost:8788/api/v1/snapshot'
    const localFlush = 'http://localhost:8788/api/v1/flush'
    const accepted = () => json({ events: 0 }, { status: 202 })
    const flushed = () => json({ processed: 0, remaining: 0, held: 0, discarded: 0, undeleted: 0 })
    const { options, requests } = job(
      { ...FULL_ENV, STATS_SNAPSHOT_URL: local },
      { [local]: accepted, [localFlush]: flushed },
    )
    await runUsageStatsSnapshot({ ...options, dryRun: false })

    expect(requests.slice(-2).map((request) => request.url)).toEqual([local, localFlush])
  })
})
