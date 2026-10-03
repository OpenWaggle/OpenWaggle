import { describe, expect, it } from 'vitest'
import type { UsageStatsSnapshot } from '../snapshot-contract'
import { computeSnapshotDeltas, parseSnapshotState, type SnapshotState } from '../snapshot-deltas'
import { NOW } from './test-support'

function snapshot(overrides: Partial<UsageStatsSnapshot> = {}): UsageStatsSnapshot {
  return {
    schema: 1,
    releases: [
      {
        tag: 'v1.0.0-beta.4',
        assets: [
          { id: 11, name: 'openwaggle-1.0.0-beta.4-arm64.dmg', download_count: 5 },
          { id: 12, name: 'alpha-mac.yml', download_count: 40 },
          { id: 13, name: 'openwaggle-1.0.0-beta.4-arm64.dmg.blockmap', download_count: 9 },
        ],
      },
    ],
    traffic: {
      views: [{ day: '2026-10-01', count: 30, uniques: 10 }],
      clones: [{ day: '2026-10-02', count: 4, uniques: 2 }],
      referrers: [{ name: 'news.ycombinator.com', count: 12, uniques: 9 }],
      paths: [{ name: '/OpenWaggle/OpenWaggle/releases', count: 7, uniques: 5 }],
    },
    npm: [{ name: '@openwaggle/extension-sdk', days: [{ day: '2026-09-30', downloads: 3 }] }],
    ...overrides,
  }
}

const DAY = 86_400_000

function events(previous: SnapshotState | null, current: UsageStatsSnapshot, now = NOW) {
  return computeSnapshotDeltas(previous, current, now)
}

describe('snapshot deltas', () => {
  it('forwards everything on the first snapshot and marks downloads as a baseline', () => {
    const first = events(null, snapshot())

    expect(first.events.map((event) => [event.event, event.properties.count])).toEqual([
      ['github.download', 5],
      ['github.download', 40],
      ['github.traffic', 30],
      ['github.traffic', 4],
      ['npm.downloads', 3],
      ['github.referrer', 12],
      ['github.popular_path', 7],
    ])
    expect(first.events[0]).toMatchObject({
      timestamp: new Date(NOW).toISOString(),
      properties: {
        distinct_id: 'openwaggle-anonymous',
        $process_person_profile: false,
        release: 'v1.0.0-beta.4',
        asset: 'openwaggle-1.0.0-beta.4-arm64.dmg',
        asset_kind: 'dmg',
        platform: 'darwin',
        arch: 'arm64',
        channel: 'beta',
        release_channel: 'beta',
        baseline: true,
      },
    })
    expect(first.events[1]?.properties).toMatchObject({
      asset_kind: 'update_check',
      channel: 'alpha',
      release_channel: 'beta',
    })
    expect(first.events[2]).toMatchObject({
      timestamp: '2026-10-01T12:00:00Z',
      properties: { kind: 'views', count: 30, uniques: 10 },
    })
    expect(first.events[5]?.properties).toMatchObject({
      referrer: 'news.ycombinator.com',
      window_days: 14,
    })
    expect(first.state.assets).toEqual({ 11: 5, 12: 40 })
  })

  it('forwards nothing for an unchanged snapshot the same day', () => {
    const first = events(null, snapshot())
    expect(events(first.state, snapshot()).events).toEqual([])
  })

  it('forwards only increases, without the baseline mark, once totals are stored', () => {
    const first = events(null, snapshot())
    const grown = snapshot({
      releases: [
        {
          tag: 'v1.0.0-beta.4',
          assets: [
            { id: 11, name: 'openwaggle-1.0.0-beta.4-arm64.dmg', download_count: 8 },
            { id: 12, name: 'alpha-mac.yml', download_count: 39 },
          ],
        },
        { tag: 'v1.0.0-beta.5', assets: [{ id: 21, name: 'SHA256SUMS.txt', download_count: 2 }] },
      ],
      traffic: {
        views: [
          { day: '2026-10-01', count: 34, uniques: 10 },
          { day: '2026-10-02', count: 5, uniques: 3 },
        ],
        clones: [],
        referrers: [],
        paths: [],
      },
      npm: [
        {
          name: '@openwaggle/extension-sdk',
          days: [
            { day: '2026-09-30', downloads: 3 },
            { day: '2026-10-01', downloads: 2 },
          ],
        },
      ],
    })

    const second = events(first.state, grown, NOW + DAY)

    expect(second.events.map((event) => [event.event, event.properties])).toEqual([
      [
        'github.download',
        expect.objectContaining({ asset: 'openwaggle-1.0.0-beta.4-arm64.dmg', count: 3 }),
      ],
      [
        'github.download',
        expect.objectContaining({ asset: 'SHA256SUMS.txt', asset_kind: 'sha256sums', count: 2 }),
      ],
      ['github.traffic', expect.objectContaining({ kind: 'views', count: 4, uniques: 0 })],
      ['github.traffic', expect.objectContaining({ kind: 'views', count: 5, uniques: 3 })],
      [
        'npm.downloads',
        expect.objectContaining({ package: '@openwaggle/extension-sdk', count: 2 }),
      ],
    ])
    expect(second.events.some((event) => 'baseline' in event.properties)).toBe(false)
    expect(second.events[0]?.timestamp).toBe(new Date(NOW + DAY / 2).toISOString())
    expect(second.state.assets).toEqual({ 11: 8, 12: 40, 21: 2 })
    expect(second.state.popularDay).toBe('2026-10-03')
    expect(second.state.lastSnapshotAt).toBe(NOW + DAY)
  })

  it("labels a feed published with an alpha release by the release's own channel too", () => {
    const alphaFeed = snapshot({
      releases: [
        { tag: 'v0.3.0-alpha.2', assets: [{ id: 31, name: 'latest-mac.yml', download_count: 4 }] },
      ],
    })
    const [event] = events(null, alphaFeed).events

    expect(event?.properties).toMatchObject({
      asset_kind: 'update_check',
      channel: 'stable',
      release_channel: 'alpha',
    })
  })

  it('counts everything as a baseline while no asset count is stored, even with a state', () => {
    const empty = events(null, snapshot({ releases: [], traffic: null, npm: [] }))
    const next = events(empty.state, snapshot(), NOW + DAY)

    expect(next.events[0]).toMatchObject({
      timestamp: new Date(NOW + DAY).toISOString(),
      properties: { baseline: true },
    })
  })

  it('sends the popular lists at most once a UTC day', () => {
    const first = events(null, snapshot())
    const again = events(first.state, snapshot(), NOW + 1000)

    expect(again.events.filter((event) => event.event === 'github.referrer')).toEqual([])
    expect(again.state.popularDay).toBe(first.state.popularDay)
  })

  it('keeps traffic and the popular day untouched when the job has no traffic token', () => {
    const first = events(null, snapshot())
    const withoutTraffic = events(first.state, snapshot({ traffic: null }), NOW + DAY)

    expect(withoutTraffic.events).toEqual([])
    expect(withoutTraffic.state.views).toEqual(first.state.views)
    expect(withoutTraffic.state.popularDay).toBe(first.state.popularDay)
  })

  it('forgets daily totals after 62 days', () => {
    const first = events(null, snapshot())
    const later = events(first.state, snapshot({ traffic: null, npm: [] }), NOW + 70 * DAY)

    expect(later.state.views).toEqual({})
    expect(later.state.npm).toEqual({ '@openwaggle/extension-sdk': {} })
    expect(later.state.assets).toEqual(first.state.assets)
  })
})

describe('snapshot state', () => {
  it('reads back the state it stores, and nothing as no state', () => {
    const { state } = events(null, snapshot())
    expect(parseSnapshotState(JSON.stringify(state))).toEqual({ ok: true, state })
    expect(parseSnapshotState(null)).toEqual({ ok: true, state: null })
  })

  it('reads a state stored before snapshots recorded their time', () => {
    const { lastSnapshotAt: _ignored, ...older } = events(null, snapshot()).state
    expect(parseSnapshotState(JSON.stringify(older))).toMatchObject({
      ok: true,
      state: { lastSnapshotAt: null },
    })
  })

  it.each([
    ['not JSON', '{'],
    [
      'another version',
      JSON.stringify({ version: 2, assets: {}, views: {}, clones: {}, npm: {}, popularDay: null }),
    ],
    [
      'a bad asset count',
      JSON.stringify({
        version: 1,
        assets: { 1: -1 },
        views: {},
        clones: {},
        npm: {},
        popularDay: null,
      }),
    ],
    [
      'a bad asset id',
      JSON.stringify({
        version: 1,
        assets: { x: 1 },
        views: {},
        clones: {},
        npm: {},
        popularDay: null,
      }),
    ],
    [
      'a bad day',
      JSON.stringify({
        version: 1,
        assets: {},
        views: { tomorrow: { count: 1, uniques: 1 } },
        clones: {},
        npm: {},
        popularDay: null,
      }),
    ],
    [
      'a bad popular day',
      JSON.stringify({ version: 1, assets: {}, views: {}, clones: {}, npm: {}, popularDay: 3 }),
    ],
    [
      'a bad snapshot time',
      JSON.stringify({
        version: 1,
        assets: {},
        views: {},
        clones: {},
        npm: {},
        popularDay: null,
        lastSnapshotAt: 'yesterday',
      }),
    ],
  ])('refuses %s instead of counting everything again', (_label, text) => {
    expect(parseSnapshotState(text)).toEqual({ ok: false })
  })
})
