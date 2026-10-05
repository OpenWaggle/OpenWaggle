import { describe, expect, it } from 'vitest'
import { runUsageStatsSnapshot } from '../usage-stats-snapshot'
import {
  DEFAULT_SNAPSHOT_URL,
  FLUSH_CALL_INTERVAL_MS,
  FLUSH_TIME_LIMIT_MS,
  MAX_FLUSH_CALLS,
} from '../usage-stats-snapshot-endpoint'
import {
  FLUSH_URL,
  FULL_ENV,
  job,
  json,
  RELEASES_URL,
  sequence,
} from './usage-stats-snapshot-test-support'

describe('usage statistics flush loop', () => {
  it('calls the flush until nothing is left', async () => {
    const flushes = sequence(
      () => json({ processed: 50, remaining: 7, held: 0, discarded: 0, undeleted: 0 }),
      () => json({ processed: 7, remaining: 0, held: 3, discarded: 0, undeleted: 0 }),
    )
    const { options, requests, lines } = job(FULL_ENV, { [FLUSH_URL]: flushes })
    await runUsageStatsSnapshot({ ...options, dryRun: false })

    expect(requests.filter((request) => request.url === FLUSH_URL)).toHaveLength(2)
    expect(lines.at(-1)).toBe('Flushed 57 buffered entries in 2 calls; 3 wait for more entries of their day.')
  })

  it('stops with a warning when a call makes no progress while entries remain', async () => {
    const stuck = () => json({ processed: 0, remaining: 4, held: 0, discarded: 0, undeleted: 0 })
    const { options, requests, lines } = job(FULL_ENV, { [FLUSH_URL]: stuck })
    await runUsageStatsSnapshot({ ...options, dryRun: false })

    expect(requests.filter((request) => request.url === FLUSH_URL)).toHaveLength(1)
    expect(lines.at(-1)).toBe(
      '::warning::Flushed 0 buffered entries in 1 calls, then stopped: the last call made no progress with 4 entries still to send. They wait for the next run.',
    )
  })

  it('ends without a warning once nothing is left to send', async () => {
    const done = () => json({ processed: 5, remaining: 0, held: 2, discarded: 0, undeleted: 0 })
    const { options, lines } = job(FULL_ENV, { [FLUSH_URL]: done })
    await runUsageStatsSnapshot({ ...options, dryRun: false })

    expect(lines.at(-1)).toBe('Flushed 5 buffered entries in 1 calls; 2 wait for more entries of their day.')
  })

  it('pauses between flush calls, since every call writes the same lease key', async () => {
    const flushes = sequence(
      () => json({ processed: 50, remaining: 7, held: 0, discarded: 0, undeleted: 0 }),
      () => json({ processed: 7, remaining: 0, held: 0, discarded: 0, undeleted: 0 }),
    )
    const { options, pauses } = job(FULL_ENV, { [FLUSH_URL]: flushes })
    await runUsageStatsSnapshot({ ...options, dryRun: false })

    expect(pauses).toEqual([FLUSH_CALL_INTERVAL_MS])
    expect(FLUSH_CALL_INTERVAL_MS).toBeGreaterThanOrEqual(1100)
  })

  it('stops flushing after its call limit', async () => {
    const endless = () => json({ processed: 1, remaining: 1, held: 0, discarded: 0, undeleted: 0 })
    const { options, requests, lines } = job(FULL_ENV, { [FLUSH_URL]: endless })
    await runUsageStatsSnapshot({ ...options, dryRun: false })

    expect(requests.filter((request) => request.url === FLUSH_URL)).toHaveLength(MAX_FLUSH_CALLS)
    expect(lines.at(-1)).toContain('::warning::Stopped flushing after 200 entries')
  })

  it('stops flushing within the job timeout however slow the calls are', async () => {
    const endless = () => json({ processed: 1, remaining: 1, held: 0, discarded: 0, undeleted: 0 })
    const { options, requests, lines } = job(FULL_ENV, { [FLUSH_URL]: endless }, 5000)
    await runUsageStatsSnapshot({ ...options, dryRun: false })

    const calls = requests.filter((request) => request.url === FLUSH_URL).length
    expect(calls).toBeLessThan(MAX_FLUSH_CALLS)
    expect(calls * (5000 + FLUSH_CALL_INTERVAL_MS)).toBeLessThanOrEqual(FLUSH_TIME_LIMIT_MS + 10_000)
    expect(FLUSH_TIME_LIMIT_MS).toBeLessThan(20 * 60_000 - 5 * 60_000)
    expect(lines.at(-1)).toContain('::warning::Stopped flushing after')
  })

  it('warns when the flush is not configured', async () => {
    const skipped = () => json({ skipped: 'POSTHOG_PROJECT_KEY is not set' }, { status: 503 })
    const { options, lines } = job(FULL_ENV, { [FLUSH_URL]: skipped })
    await runUsageStatsSnapshot({ ...options, dryRun: false })

    expect(lines.at(-1)).toBe('::warning::The endpoint flushed nothing: POSTHOG_PROJECT_KEY is not set.')
  })

  it('passes each cursor on to the next flush call', async () => {
    const flushes = sequence(
      () => json({ processed: 0, remaining: 1, held: 10, discarded: 0, undeleted: 0, cursor: 'page-6' }),
      () => json({ processed: 5, remaining: 0, held: 0, discarded: 0, undeleted: 0 }),
    )
    const { options, requests } = job(FULL_ENV, { [FLUSH_URL]: flushes })
    await runUsageStatsSnapshot({ ...options, dryRun: false })

    const bodies = requests.filter((request) => request.url === FLUSH_URL).map((request) => request.init.body)
    expect(bodies).toEqual(['{}', '{"cursor":"page-6"}'])
  })

  it('keeps flushing while a call is only cleaning up', async () => {
    const flushes = sequence(
      () => json({ processed: 0, remaining: 30, held: 0, discarded: 0, cleaned: 20, undeleted: 0 }),
      () => json({ processed: 5, remaining: 0, held: 0, discarded: 0, cleaned: 10, undeleted: 0 }),
    )
    const { options, requests } = job(FULL_ENV, { [FLUSH_URL]: flushes })
    await runUsageStatsSnapshot({ ...options, dryRun: false })

    expect(requests.filter((request) => request.url === FLUSH_URL)).toHaveLength(2)
  })

  it('stops with a warning when another flush took over', async () => {
    const takenOver = () => json({ skipped: 'another flush took over' }, { status: 409 })
    const { options, lines } = job(FULL_ENV, { [FLUSH_URL]: takenOver })
    await runUsageStatsSnapshot({ ...options, dryRun: false })

    expect(lines.at(-1)).toBe('::warning::The endpoint flushed nothing: another flush took over.')
  })

  it('stops flushing and fails when a flush could not delete what it published', async () => {
    const flushes = sequence(
      () => json({ processed: 50, remaining: 9, held: 0, discarded: 0, undeleted: 2 }),
      () => json({ processed: 9, remaining: 0, held: 0, discarded: 0, undeleted: 0 }),
    )
    const { options, requests } = job(FULL_ENV, { [FLUSH_URL]: flushes })

    await expect(runUsageStatsSnapshot({ ...options, dryRun: false })).rejects.toThrow(
      'could not delete (2)',
    )
    expect(requests.filter((request) => request.url === FLUSH_URL)).toHaveLength(1)
  })

  it('still flushes when the snapshot fails, then fails the run', async () => {
    const broken = () => json({ error: 'internal error' }, { status: 500 })
    const { options, requests, lines } = job(FULL_ENV, { [DEFAULT_SNAPSHOT_URL]: broken })

    await expect(runUsageStatsSnapshot({ ...options, dryRun: false })).rejects.toThrow(
      'The snapshot failed: Endpoint /api/v1/snapshot answered 500',
    )
    expect(requests.some((request) => request.url === FLUSH_URL)).toBe(true)
    expect(lines.some((line) => line.startsWith('::error::The snapshot failed'))).toBe(true)
  })

  it('still flushes when GitHub cannot be read', async () => {
    const { options, requests } = job(FULL_ENV, { [RELEASES_URL]: () => json({}, { status: 502 }) })

    await expect(runUsageStatsSnapshot({ ...options, dryRun: false })).rejects.toThrow(
      'GitHub releases answered 502.',
    )
    expect(requests.some((request) => request.url === DEFAULT_SNAPSHOT_URL)).toBe(false)
    expect(requests.some((request) => request.url === FLUSH_URL)).toBe(true)
  })

  it('fails when the flush answers an error', async () => {
    const broken = () => json({ error: 'internal error' }, { status: 500 })
    const { options } = job(FULL_ENV, { [FLUSH_URL]: broken })

    await expect(runUsageStatsSnapshot({ ...options, dryRun: false })).rejects.toThrow(
      'Endpoint /api/v1/flush answered 500',
    )
  })
})
