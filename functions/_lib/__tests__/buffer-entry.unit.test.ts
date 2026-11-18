import { describe, expect, it } from 'vitest'
import { USAGE_STATISTICS_CONTEXT_FIELDS } from '../../../src/shared/usage-statistics/contract'
import {
  BufferEntryBuilder,
  bufferExpiration,
  bufferKey,
  bufferKeyDay,
  contextEntries,
  entryPointCombination,
  flushedKey,
  hasAppEvents,
  parseBufferEntry,
  serializeBufferEntry,
} from '../buffer-entry'
import { addUpEntries } from '../flush-totals'
import { CONTEXT, testUuid, YESTERDAY } from './test-support'

describe('buffer entries', () => {
  it('lists every context field the contract defines, in order', () => {
    expect(contextEntries(CONTEXT).map(([field]) => field)).toEqual(
      Object.keys(USAGE_STATISTICS_CONTEXT_FIELDS),
    )
  })

  it('adds equal rows up as it collects them', () => {
    const builder = new BufferEntryBuilder()
    builder.count('run.finished', 'os', 'darwin')
    builder.count('run.finished', 'os', 'darwin')
    builder.count('run.finished', 'os', 'linux', 3)
    builder.sum('run.finished', 'duration_s', 10)
    builder.sum('run.finished', 'duration_s', 5)

    expect(builder.build(YESTERDAY)).toEqual({
      day: YESTERDAY,
      counts: [
        ['run.finished', 'os', 'darwin', 2],
        ['run.finished', 'os', 'linux', 3],
      ],
      sums: [['run.finished', 'duration_s', 15, 2]],
    })
  })

  it('reads back what it stores, and adds entries of a day up', () => {
    const builder = new BufferEntryBuilder()
    builder.count('app.opened', '_count', '1', 2)
    builder.sum('endpoint.request', 'accepted', 2)
    const entry = builder.build(YESTERDAY)
    const parsed = parseBufferEntry(serializeBufferEntry(entry), YESTERDAY)

    expect(parsed).toEqual(entry)
    expect(addUpEntries(YESTERDAY, [entry, entry])).toEqual({
      day: YESTERDAY,
      values: [
        {
          event: 'app.opened',
          field: '_count',
          value: '1',
          count: 4,
          contributors: new Set([0, 1]),
        },
      ],
      sums: [
        {
          event: 'endpoint.request',
          field: 'accepted',
          sum: 4,
          count: 2,
          contributors: new Set([0, 1]),
        },
      ],
    })
  })

  it.each([
    ['not JSON', '{'],
    ['another version', '{"v":2,"day":"2026-10-01","c":[],"s":[]}'],
    ['another day', '{"v":1,"day":"2026-09-30","c":[],"s":[]}'],
    ['a zero count', '{"v":1,"day":"2026-10-01","c":[["a","b","c",0]],"s":[]}'],
    ['a short row', '{"v":1,"day":"2026-10-01","c":[["a","b",1]],"s":[]}'],
    ['a negative sum', '{"v":1,"day":"2026-10-01","c":[],"s":[["a","b",-1,1]]}'],
    [
      'an over-long value',
      `{"v":1,"day":"2026-10-01","c":[["a","b","${'x'.repeat(257)}",1]],"s":[]}`,
    ],
  ])('refuses an entry with %s', (_label, text) => {
    expect(parseBufferEntry(text, YESTERDAY)).toBeUndefined()
  })

  it('expires the entries of a day and their tombstones 45 days after the day ends', () => {
    expect(bufferExpiration(YESTERDAY)).toBe(Date.parse('2026-11-16T00:00:00Z') / 1000)
    expect(flushedKey(bufferKey(YESTERDAY, testUuid(1)))).toBe(
      `flushed:buf:${YESTERDAY}:${testUuid(1)}`,
    )
  })

  it('tells an entry with accepted app events from one with request counts only', () => {
    const counts = new BufferEntryBuilder()
    counts.count('endpoint.requests', '_count', '1')
    const events = new BufferEntryBuilder()
    events.count('app.opened', '_count', '1')

    expect(hasAppEvents(counts.build(YESTERDAY))).toBe(false)
    expect(hasAppEvents(events.build(YESTERDAY))).toBe(true)
  })

  it("names a day's entry points as one combination, in contract order", () => {
    expect(
      [
        ['app'],
        ['cli'],
        ['agent'],
        ['cli', 'app'],
        ['agent', 'app'],
        ['agent', 'cli'],
        ['agent', 'cli', 'app'],
      ].map(entryPointCombination),
    ).toEqual(['app', 'cli', 'agent', 'app+cli', 'app+agent', 'cli+agent', 'app+cli+agent'])
  })

  it('keys an entry by day and a random UUID only', () => {
    const key = bufferKey(YESTERDAY, testUuid(7))
    expect(key).toBe(`buf:${YESTERDAY}:00000000-0000-4000-8000-000000000007`)
    expect(bufferKeyDay(key)).toBe(YESTERDAY)
    expect(bufferKeyDay(`buf:${YESTERDAY}:not-a-uuid`)).toBeUndefined()
    expect(bufferKeyDay(`web-salt:${YESTERDAY}`)).toBeUndefined()
  })
})
