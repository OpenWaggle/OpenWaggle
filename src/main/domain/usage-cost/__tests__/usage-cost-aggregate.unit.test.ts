import type { UsageCostQuery, UsageCostSessionQuery } from '@shared/types/usage-cost'
import { describe, expect, it } from 'vitest'
import {
  aggregateUsageCostView,
  localDayKey,
  rangeStartForPreset,
  selectUsageCostSessions,
  USAGE_COST_TOOLS_MODEL_ID,
  USAGE_COST_TOOLS_MODEL_PROVIDER,
  type UsageCostRecord,
  type UsageCostScanSession,
} from '../usage-cost-aggregate'

const NOW = new Date('2026-10-14T12:00:00')

const DAY_MS = 24 * 60 * 60 * 1000

function record(overrides: Partial<UsageCostRecord> & { timestampMs: number }): UsageCostRecord {
  return {
    provider: 'anthropic',
    modelId: 'claude-opus-5-5',
    tokens: { input: 100, output: 200, cacheRead: 0, cacheWrite: 0 },
    totalTokens: 300,
    recordedCostUsd: null,
    estimatedCostUsd: null,
    ...overrides,
  }
}

function session(
  overrides: Partial<UsageCostScanSession> & { readonly file: string },
): UsageCostScanSession {
  return {
    sessionId: null,
    cwd: null,
    resolvedProjectPath: null,
    origin: 'other-pi-clients',
    startedAtMs: null,
    lastActivityMs: null,
    records: [],
    ...overrides,
  }
}

const DISPLAY = {
  homePath: '/Users/dev',
  temporaryRoots: ['/tmp'],
  displayNames: { '/Users/dev/Projects/alpha': 'Alpha' },
}

function viewInput(
  sessions: readonly UsageCostScanSession[],
  stats = { scannedFiles: sessions.length, scannedFilesCached: 0, scanDurationMs: 5 },
) {
  return { sessions, stats, display: DISPLAY }
}

const QUERY: UsageCostQuery = { preset: 'all', origin: 'all' }

describe('aggregateUsageCostView', () => {
  it('sums recorded, estimated, and unpriced costs into disjoint tiers', () => {
    const input = viewInput([
      session({
        file: '/a.jsonl',
        records: [
          record({ timestampMs: NOW.getTime(), recordedCostUsd: 0.5 }),
          record({ timestampMs: NOW.getTime(), estimatedCostUsd: 0.25 }),
          record({ timestampMs: NOW.getTime() }),
        ],
      }),
    ])

    const view = aggregateUsageCostView(input, QUERY, NOW)

    expect(view.totals.recordedCostUsd).toBe(0.5)
    expect(view.totals.estimatedCostUsd).toBe(0.25)
    expect(view.totals.unpricedTokens).toBe(300)
    expect(view.totals.tokens.total).toBe(900)
    expect(view.unpricedShare).toBeCloseTo(300 / 900)
  })

  it('filters records by the query window and origin', () => {
    const tenDaysAgo = NOW.getTime() - 10 * DAY_MS
    const input = viewInput([
      session({
        file: '/openwaggle.jsonl',
        origin: 'openwaggle',
        records: [record({ timestampMs: tenDaysAgo, recordedCostUsd: 1 })],
      }),
      session({
        file: '/cli.jsonl',
        origin: 'other-pi-clients',
        records: [record({ timestampMs: NOW.getTime(), recordedCostUsd: 2 })],
      }),
    ])

    const openWaggleOnly = aggregateUsageCostView(
      input,
      { preset: '7d', origin: 'openwaggle' },
      NOW,
    )
    expect(openWaggleOnly.totals.tokens.total).toBe(0)
    expect(openWaggleOnly.sessionCount).toBe(0)

    const allSevenDays = aggregateUsageCostView(input, { preset: '7d', origin: 'all' }, NOW)
    expect(allSevenDays.totals.recordedCostUsd).toBe(2)
    expect(allSevenDays.sessionCount).toBe(1)

    const allTime = aggregateUsageCostView(input, { preset: 'all', origin: 'all' }, NOW)
    expect(allTime.totals.recordedCostUsd).toBe(3)
    expect(allTime.sessionCount).toBe(2)
  })

  it('buckets days in local time and attributes tool results to the Pi tools bucket', () => {
    // 22:30 UTC on Oct 13 is 00:30 on Oct 14 in a UTC+2 machine clock: the local
    // day crosses the UTC day boundary, so the bucket must not follow UTC days.
    const afterLocalMidnight = Date.UTC(2026, 9, 13, 22, 30)
    const input = viewInput([
      session({
        file: '/a.jsonl',
        records: [
          record({ timestampMs: afterLocalMidnight }),
          record({
            timestampMs: afterLocalMidnight,
            provider: USAGE_COST_TOOLS_MODEL_PROVIDER,
            modelId: USAGE_COST_TOOLS_MODEL_ID,
          }),
        ],
      }),
    ])

    const view = aggregateUsageCostView(input, QUERY, NOW)
    expect(view.days).toHaveLength(1)
    expect(view.days[0]?.day).toBe(localDayKey(afterLocalMidnight, NOW))
    const tools = view.models.find((model) => model.modelId === USAGE_COST_TOOLS_MODEL_ID)
    expect(tools).toBeDefined()
    expect(view.models[0]?.modelId).not.toBe(USAGE_COST_TOOLS_MODEL_ID)
  })

  it('groups projects by resolved project with display-safe labels and detail paths', () => {
    const input = viewInput([
      session({
        file: '/a.jsonl',
        cwd: '/Users/dev/Projects/alpha',
        records: [record({ timestampMs: NOW.getTime() })],
      }),
      session({
        // A managed worktree resolved through its git pointer to the same project.
        file: '/b.jsonl',
        cwd: '/Users/dev/.openwaggle/worktrees/alpha/873e0584',
        resolvedProjectPath: '/Users/dev/Projects/alpha',
        records: [record({ timestampMs: NOW.getTime() })],
      }),
      session({ file: '/c.jsonl', cwd: null, records: [record({ timestampMs: NOW.getTime() })] }),
    ])

    const view = aggregateUsageCostView(input, QUERY, NOW)
    expect(view.projects).toHaveLength(2)
    expect(view.projects[0]?.label).toBe('Alpha')
    expect(view.projects[0]?.detail).toBe('~/Projects/alpha')
    expect(view.projects[0]?.tokens.total).toBe(600)
    expect(view.projects.find((project) => project.projectPath === null)?.label).toBe(
      'Unknown location',
    )
  })

  it('groups temporary directories under one label and never shows a raw path', () => {
    const input = viewInput([
      session({
        file: '/s.jsonl',
        cwd: '/tmp/ow-scratch-501/19fa3e03/9b6f3b288ce1',
        resolvedProjectPath: '/tmp',
        records: [record({ timestampMs: NOW.getTime() })],
      }),
    ])

    const view = aggregateUsageCostView(input, QUERY, NOW)
    expect(view.projects[0]?.label).toBe('Temporary directory')
    expect(view.projects[0]?.detail).toBeNull()
  })

  it('falls back to the leaf name with an abbreviated detail for unresolved cwds', () => {
    const input = viewInput([
      session({
        file: '/x.jsonl',
        cwd: '/Users/dev/Desktop/unresolved',
        records: [record({ timestampMs: NOW.getTime() })],
      }),
    ])

    const view = aggregateUsageCostView(input, QUERY, NOW)
    expect(view.projects[0]?.label).toBe('unresolved')
    expect(view.projects[0]?.detail).toBe('~/Desktop/unresolved')
  })
})

describe('selectUsageCostSessions', () => {
  it('narrows to sessions matching every drill-down dimension', () => {
    const today = NOW.getTime() - 60 * 60 * 1000
    const input = viewInput([
      session({
        file: '/match.jsonl',
        cwd: '/proj',
        records: [
          record({ timestampMs: today, provider: 'anthropic', modelId: 'claude-opus-5-5' }),
        ],
      }),
      session({
        file: '/other-model.jsonl',
        cwd: '/proj',
        records: [
          record({ timestampMs: today, provider: 'anthropic', modelId: 'claude-sonnet-5' }),
        ],
      }),
      session({
        file: '/other-day.jsonl',
        cwd: '/proj',
        records: [record({ timestampMs: NOW.getTime() - 40 * DAY_MS })],
      }),
    ])

    const sessionQuery: UsageCostSessionQuery = {
      preset: 'all',
      origin: 'all',
      day: localDayKey(today, NOW),
      provider: 'anthropic',
      modelId: 'claude-opus-5-5',
      projectPath: '/proj',
    }

    const rows = selectUsageCostSessions(input, sessionQuery, NOW)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.file).toBe('/match.jsonl')
    expect(rows[0]?.tokens.total).toBe(300)
    // Paths outside home display as the leaf only — never a raw absolute path.
    expect(rows[0]?.displayCwd).toBe('proj')
  })

  it('selects the no-working-directory group when projectPath is null', () => {
    const input = viewInput([
      session({
        file: '/none.jsonl',
        cwd: null,
        records: [record({ timestampMs: NOW.getTime() })],
      }),
      session({
        file: '/some.jsonl',
        cwd: '/proj',
        records: [record({ timestampMs: NOW.getTime() })],
      }),
    ])

    const rows = selectUsageCostSessions(
      input,
      { preset: 'all', origin: 'all', projectPath: null },
      NOW,
    )
    expect(rows.map((row) => row.file)).toEqual(['/none.jsonl'])
    expect(rows[0]?.projectLabel).toBe('Unknown location')
  })

  it('returns the most recently active sessions first', () => {
    const input = viewInput([
      session({
        file: '/older.jsonl',
        records: [record({ timestampMs: NOW.getTime() - 2 * DAY_MS })],
      }),
      session({
        file: '/newer.jsonl',
        records: [record({ timestampMs: NOW.getTime() - DAY_MS })],
      }),
    ])

    const rows = selectUsageCostSessions(input, { preset: 'all', origin: 'all' }, NOW)
    expect(rows.map((row) => row.file)).toEqual(['/newer.jsonl', '/older.jsonl'])
  })
})

describe('rangeStartForPreset', () => {
  it('maps presets to window bounds', () => {
    expect(rangeStartForPreset('all', NOW)).toBeNull()
    expect(rangeStartForPreset('7d', NOW)).toBe(NOW.getTime() - 7 * DAY_MS)
    expect(rangeStartForPreset('30d', NOW)).toBe(NOW.getTime() - 30 * DAY_MS)
    expect(rangeStartForPreset('90d', NOW)).toBe(NOW.getTime() - 90 * DAY_MS)
  })
})
