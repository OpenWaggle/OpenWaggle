import { describe, expect, it } from 'vitest'
import { type BufferEntry, bufferKeyDay, parseBufferEntry } from '../buffer-entry'
import { deterministicUuid } from '../flush-aggregate'
import {
  addUpEntries,
  MIN_CONTRIBUTING_ENTRIES,
  OTHER_VALUE,
  publishableTotals,
} from '../flush-totals'
import {
  aggregatedRecords,
  bufferRequests,
  flush,
  type PublishedRecord,
  publishedCount,
} from './flush-test-support'
import { CONTEXT, MemoryKeyValueStore, runFinished, YESTERDAY } from './test-support'

/** Seven full UTC days, the day itself included, have ended by today, 2026-10-02. */
const AGED_DAY = '2026-09-25'

/** An `install.active` day; one not `alike` used neither the terminal, Playwright nor the CLI. */
function activeDay(alike: boolean) {
  return {
    name: 'install.active',
    day: YESTERDAY,
    properties: {
      first_this_week: false,
      first_this_month: false,
      install_age: '31-90d',
      entry_points: alike ? ['app', 'cli'] : ['app'],
      extensions_enabled: '0',
      ...(alike ? { terminal: true, mcp_servers: ['playwright'] } : {}),
    },
  }
}

const ONBOARDING = {
  name: 'install.onboarding',
  day: YESTERDAY,
  properties: {
    provider_within_first_day: true,
    run_within_first_day: false,
    project_within_first_day: true,
  },
}

type Contributors = ReadonlyMap<string, ReadonlySet<string>>

/** The stored entries, by key, behind each value and each integer sum, as `[event, field, value]`. */
function contributors(store: MemoryKeyValueStore): Contributors {
  const entries = new Map<string, Set<string>>()
  const add = (row: string, key: string) =>
    entries.set(row, new Set([...(entries.get(row) ?? []), key]))
  for (const [key, { value }] of store.entries) {
    const day = bufferKeyDay(key)
    const entry = day === undefined ? undefined : parseBufferEntry(value, day)
    for (const [event, field, text] of entry?.counts ?? [])
      add(JSON.stringify([event, field, text]), key)
    for (const [event, field] of entry?.sums ?? []) add(JSON.stringify([event, field, SUM]), key)
  }
  return entries
}

const SUM = '(sum)'

/** The entries a published row stands for; `(other)` stands for every value not published. */
function groupOf(
  record: PublishedRecord,
  records: readonly PublishedRecord[],
  counted: Contributors,
) {
  const field = String(record.properties.field)
  if ('sum' in record.properties)
    return counted.get(JSON.stringify([record.event, field, SUM])) ?? new Set()
  if (record.properties.value !== OTHER_VALUE) {
    return (
      counted.get(JSON.stringify([record.event, field, String(record.properties.value)])) ??
      new Set()
    )
  }
  const published = new Set(
    records
      .filter((other) => other.event === record.event && other.properties.field === field)
      .map((other) => String(other.properties.value)),
  )
  const folded = [...counted].filter(([row]) => {
    const [event, rowField, value] = JSON.parse(row)
    return event === record.event && rowField === field && value !== SUM && !published.has(value)
  })
  return new Set(folded.flatMap(([, entries]) => [...entries]))
}

/**
 * Every published row besides event totals, `(other)` included, stands for at least 5 entries,
 * and the entries of its event that it leaves out, which `_count` minus the row reveals, are
 * none or at least 5 too.
 */
function expectNoSmallCells(records: readonly PublishedRecord[], counted: Contributors) {
  for (const record of records) {
    const field = String(record.properties.field)
    if (field === '_count') continue
    const label = `${record.event} ${field} ${String(record.properties.value ?? SUM)}`
    const group = groupOf(record, records, counted)
    const eventEntries = counted.get(JSON.stringify([record.event, '_count', '1'])) ?? new Set()
    const lacking = [...eventEntries].filter((entry) => !group.has(entry)).length
    expect(group.size, label).toBeGreaterThanOrEqual(MIN_CONTRIBUTING_ENTRIES)
    expect(
      lacking === 0 || lacking >= MIN_CONTRIBUTING_ENTRIES,
      `${label}: ${String(lacking)} lack it`,
    ).toBe(true)
  }
}

async function flushStore(store: MemoryKeyValueStore) {
  const counted = contributors(store)
  const records = aggregatedRecords((await flush(store)).requests)
  return { counted, records }
}

/** The first `high` requests report `high`, the next `low` ones `low`, the rest `medium`. */
const LEVELS = (high: number, low: number) => (index: number) => {
  const level = index < high ? 'high' : index < high + low ? 'low' : 'medium'
  return [runFinished({ thinking_level: level })]
}

/** Every published row other than event totals: breakdown values, `(other)` and sums. */
function breakdownRows(records: readonly PublishedRecord[]) {
  return records.filter((record) => record.properties.field !== '_count')
}

describe('small-cell suppression', () => {
  it('probe: folds a published value that would leave (other) standing for one entry', async () => {
    const store = new MemoryKeyValueStore()
    await bufferRequests(
      store,
      6,
      YESTERDAY,
      () => [runFinished()],
      (index) => ({ ...CONTEXT, arch: index < 5 ? 'x64' : 'arm64' }),
    )
    const { counted, records } = await flushStore(store)

    expect(publishedCount(records, 'run.finished', '_count', '1')).toBe(6)
    expect(records.filter((record) => record.properties.field === 'arch')).toEqual([])
    expect(publishedCount(records, 'run.finished', 'os', 'darwin')).toBe(6)
    expectNoSmallCells(records, counted)
  })

  it('probe: hides a value that all but one install reported, as _count would give it away', async () => {
    const store = new MemoryKeyValueStore()
    await bufferRequests(store, 6, YESTERDAY, (index) => [activeDay(index < 5)])
    const { counted, records } = await flushStore(store)
    const fields = new Set(records.map((record) => record.properties.field))

    expect(publishedCount(records, 'install.active', '_count', '1')).toBe(6)
    expect(fields.has('terminal')).toBe(false)
    expect(fields.has('mcp_servers')).toBe(false)
    expect(fields.has('entry_points')).toBe(false)
    expect(publishedCount(records, 'install.active', 'install_age', '31-90d')).toBe(6)
    expectNoSmallCells(records, counted)
  })

  it('counts installs that left an optional flag out as a group of their own', async () => {
    const store = new MemoryKeyValueStore()
    await bufferRequests(store, 20, YESTERDAY, (index) => [activeDay(index >= 3)])
    const { counted, records } = await flushStore(store)

    expect(publishedCount(records, 'install.active', '_count', '1')).toBe(20)
    expect(records.some((record) => record.properties.field === 'terminal')).toBe(false)
    expect(records.some((record) => record.properties.field === 'mcp_servers')).toBe(false)
    expectNoSmallCells(records, counted)
  })

  it('publishes a value that a large enough group of installs lacks', async () => {
    const store = new MemoryKeyValueStore()
    await bufferRequests(store, 10, YESTERDAY, (index) => [activeDay(index < 5)])
    const { counted, records } = await flushStore(store)

    expect(publishedCount(records, 'install.active', 'terminal', 'true')).toBe(5)
    expect(publishedCount(records, 'install.active', 'mcp_servers', 'playwright')).toBe(5)
    expect(publishedCount(records, 'install.active', 'entry_points', 'app')).toBe(5)
    expect(publishedCount(records, 'install.active', 'entry_points', 'app+cli')).toBe(5)
    expectNoSmallCells(records, counted)
  })

  it('probe: never reveals how many installs used more than one entry point', async () => {
    const store = new MemoryKeyValueStore()
    const entryPoints = (index: number) =>
      index < 6 ? ['app'] : index < 11 ? ['cli'] : ['app', 'cli']
    await bufferRequests(store, 12, YESTERDAY, (index) => [
      {
        ...activeDay(true),
        properties: { ...activeDay(true).properties, entry_points: entryPoints(index) },
      },
    ])
    const { counted, records } = await flushStore(store)
    const entryPointRows = records.filter((record) => record.properties.field === 'entry_points')
    const published = entryPointRows.reduce(
      (sum, record) => sum + Number(record.properties.count),
      0,
    )

    expect(publishedCount(records, 'install.active', '_count', '1')).toBe(12)
    expect(entryPointRows.map((record) => record.properties.value)).not.toContain('app+cli')
    expect(published).toBe(12)
    expectNoSmallCells(records, counted)
  })

  it('publishes (other) once it stands for at least five entries', async () => {
    const store = new MemoryKeyValueStore()
    await bufferRequests(store, 11, YESTERDAY, LEVELS(6, 3))
    const { counted, records } = await flushStore(store)

    expect(publishedCount(records, 'run.finished', 'thinking_level', 'high')).toBe(6)
    expect(publishedCount(records, 'run.finished', 'thinking_level', 'low')).toBeUndefined()
    expect(publishedCount(records, 'run.finished', 'thinking_level', OTHER_VALUE)).toBe(5)
    expectNoSmallCells(records, counted)
  })

  it('folds the smallest published values until (other) stands for five entries', async () => {
    const store = new MemoryKeyValueStore()
    await bufferRequests(store, 14, YESTERDAY, LEVELS(7, 5))
    const { counted, records } = await flushStore(store)

    expect(publishedCount(records, 'run.finished', 'thinking_level', 'high')).toBe(7)
    expect(publishedCount(records, 'run.finished', 'thinking_level', 'low')).toBeUndefined()
    expect(publishedCount(records, 'run.finished', 'thinking_level', OTHER_VALUE)).toBe(7)
    expectNoSmallCells(records, counted)
  })

  it('probe A: publishes only event totals for an aged day of one install with 37 Runs', async () => {
    const store = new MemoryKeyValueStore()
    await bufferRequests(store, 1, AGED_DAY, () =>
      Array.from({ length: 37 }, () => runFinished({}, AGED_DAY)),
    )
    const { counted, records } = await flushStore(store)

    expect(publishedCount(records, 'run.finished', '_count', '1')).toBe(37)
    expect(breakdownRows(records)).toEqual([])
    expectNoSmallCells(records, counted)
  })

  it('probe D: one entry with 7 Runs cannot carry a value past the threshold alone', async () => {
    const store = new MemoryKeyValueStore()
    await bufferRequests(store, 5, YESTERDAY, (index) =>
      index === 4
        ? Array.from({ length: 7 }, () =>
            runFinished({ model: 'claude-opus-4-5', thinking_level: 'max', duration_s: 900 }),
          )
        : [runFinished()],
    )
    const { counted, records } = await flushStore(store)

    expect(publishedCount(records, 'run.finished', '_count', '1')).toBe(11)
    expect(records.filter((record) => record.properties.field === 'model')).toEqual([])
    expect(records.filter((record) => record.properties.field === 'thinking_level')).toEqual([])
    expect(publishedCount(records, 'run.finished', 'os', 'darwin')).toBe(11)
    expect(
      records.find((record) => record.event === 'run.finished' && 'sum' in record.properties),
    ).toMatchObject({ properties: { field: 'duration_s', count: 11 } })
    expectNoSmallCells(records, counted)
  })

  it('publishes only the total of an event seen once', async () => {
    const store = new MemoryKeyValueStore()
    await bufferRequests(store, 5, YESTERDAY, (index) =>
      index === 0 ? [runFinished(), ONBOARDING] : [runFinished()],
    )
    const { counted, records } = await flushStore(store)
    const onboarding = records.filter((record) => record.event === 'install.onboarding')

    expect(publishedCount(onboarding, 'install.onboarding', '_count', '1')).toBe(1)
    expect(breakdownRows(onboarding)).toEqual([])
    expectNoSmallCells(records, counted)
  })

  it('leaves out the integer sums of an event reported by fewer than five entries', async () => {
    const store = new MemoryKeyValueStore()
    await bufferRequests(store, 6, YESTERDAY, (index) =>
      index < 3 ? [runFinished()] : [{ name: 'app.opened', day: YESTERDAY, properties: {} }],
    )
    const { counted, records } = await flushStore(store)

    expect(publishedCount(records, 'run.finished', '_count', '1')).toBe(3)
    expect(
      records.some((record) => record.event === 'run.finished' && 'sum' in record.properties),
    ).toBe(false)
    expect(records.find((record) => record.properties.field === 'accepted')).toMatchObject({
      event: 'endpoint.requests',
      properties: { sum: 6, count: 6 },
    })
    expectNoSmallCells(records, counted)
  })

  it('counts the entries behind each value, not its events', () => {
    const entry = (os: string, runs: number): BufferEntry => ({
      day: YESTERDAY,
      counts: [
        ['run.finished', '_count', '1', runs],
        ['run.finished', 'os', os, runs],
      ],
      sums: [['run.finished', 'duration_s', runs * 10, runs]],
    })
    const totals = addUpEntries(YESTERDAY, [
      entry('linux', 37),
      ...Array.from({ length: 6 }, () => entry('darwin', 1)),
      ...Array.from({ length: 5 }, () => entry('win32', 1)),
    ])

    expect(publishableTotals(totals)).toEqual({
      day: YESTERDAY,
      counts: [
        ['run.finished', '_count', '1', 48],
        ['run.finished', 'os', 'darwin', 6],
        ['run.finished', 'os', OTHER_VALUE, 42],
      ],
      sums: [['run.finished', 'duration_s', 480, 48]],
    })
  })
})

describe('deterministic record ids', () => {
  it('derives the same v4-formatted UUID from the same material, and another from other material', async () => {
    const uuid = await deterministicUuid('material')

    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
    expect(await deterministicUuid('material')).toBe(uuid)
    expect(await deterministicUuid('other material')).not.toBe(uuid)
  })
})
