import { TERMINAL } from '@shared/constants/resource-limits'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import { makeTerminalInactiveRecordPruner } from '../terminal-inactive-record-pruner'
import type { TerminalRecord } from '../terminal-records'
import { createTerminalScrollback, type TerminalScrollback } from '../terminal-scrollback'

function recordWithScrollback(key: string, scrollback: TerminalScrollback) {
  return fromPartial<TerminalRecord>({
    key,
    ownerKey: key.split('::')[0] ?? key,
    terminalId: key.split('::')[1] ?? 'main',
    scrollback,
    closed: false,
    live: null,
    exitCode: 0,
    termination: null,
    ownerMigration: null,
    pendingOutput: '',
    pendingOutputBytes: 0,
    pendingInput: [],
    pendingInputBytes: 0,
    inFlightOutput: null,
  })
}

function inactiveRecord(key: string, bytes = 0) {
  const scrollback = createTerminalScrollback(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
  if (bytes > 0) scrollback.append('x'.repeat(bytes))
  return recordWithScrollback(key, scrollback)
}

function byteSizedInactiveRecord(key: string, initialBytes: number) {
  let byteCount = initialBytes
  const scrollback = fromPartial<TerminalScrollback>({
    append: () => undefined,
    reset: () => {
      byteCount = 0
    },
    toString: () => '',
    get byteCount() {
      return byteCount
    },
    lineCount: 0,
  })
  return recordWithScrollback(key, scrollback)
}

function setup(
  records: readonly TerminalRecord[],
  limits: Partial<{ readonly maxRecords: number; readonly maxScrollbackBytes: number }> = {},
  attached = new Set<string>(),
) {
  const byKey = new Map(records.map((record) => [record.key, record]))
  const pruner = makeTerminalInactiveRecordPruner({
    records: byKey,
    isAttached: (key) => attached.has(key),
    evict: (record) => {
      const removed = byKey.delete(record.key)
      record.scrollback.reset()
      return removed
    },
    ...limits,
  })
  for (const record of records) pruner.markInactive(record)
  return { byKey, pruner }
}

describe('terminal inactive record pruner', () => {
  it('evicts the oldest inactive records to satisfy the count bound', () => {
    const oldest = inactiveRecord('session::oldest')
    const middle = inactiveRecord('session::middle')
    const newest = inactiveRecord('session::newest')
    const { byKey, pruner } = setup([oldest, middle, newest], {
      maxRecords: 1,
      maxScrollbackBytes: Number.MAX_SAFE_INTEGER,
    })

    expect(pruner.prune()).toEqual([oldest, middle])
    expect([...byKey.keys()]).toEqual([newest.key])
  })

  it('retains at most 128 eligible inactive records by default', () => {
    const records = Array.from({ length: TERMINAL.MAX_INACTIVE_RECORDS + 2 }, (_, index) =>
      inactiveRecord(`session::terminal-${index}`),
    )
    const { byKey, pruner } = setup(records)

    expect(pruner.prune()).toEqual(records.slice(0, 2))
    expect(byKey.size).toBe(TERMINAL.MAX_INACTIVE_RECORDS)
  })

  it('evicts enough records to satisfy the aggregate scrollback byte bound', () => {
    const oldest = inactiveRecord('session::oldest', 4)
    const middle = inactiveRecord('session::middle', 5)
    const newest = inactiveRecord('session::newest', 6)
    const { byKey, pruner } = setup([oldest, middle, newest], {
      maxRecords: 128,
      maxScrollbackBytes: 6,
    })

    expect(pruner.prune()).toEqual([oldest, middle])
    expect([...byKey.values()]).toEqual([newest])
    expect(newest.scrollback.byteCount).toBe(6)
  })

  it('retains at most 64 MiB of eligible inactive scrollback by default', () => {
    const bytesPerRecord = 40 * 1024 * 1024
    const oldest = byteSizedInactiveRecord('session::oldest', bytesPerRecord)
    const newest = byteSizedInactiveRecord('session::newest', bytesPerRecord)
    const { byKey, pruner } = setup([oldest, newest])

    expect(pruner.prune()).toEqual([oldest])
    expect([...byKey.values()]).toEqual([newest])
    expect(newest.scrollback.byteCount).toBeLessThanOrEqual(TERMINAL.MAX_INACTIVE_SCROLLBACK_BYTES)
  })

  it('protects attached, live, spawning, terminating, and undrained records', () => {
    const attached = inactiveRecord('session::attached')
    const live = inactiveRecord('session::live')
    live.live = fromPartial<NonNullable<TerminalRecord['live']>>({})
    const spawning = inactiveRecord('session::spawning')
    spawning.exitCode = null
    const terminating = inactiveRecord('session::terminating')
    terminating.termination = fromPartial<NonNullable<TerminalRecord['termination']>>({})
    const pending = inactiveRecord('session::pending')
    pending.pendingOutput = 'pending'
    pending.pendingOutputBytes = 7
    const inFlight = inactiveRecord('session::in-flight')
    inFlight.inFlightOutput = fromPartial<NonNullable<TerminalRecord['inFlightOutput']>>({})
    const pendingInput = inactiveRecord('session::pending-input')
    pendingInput.pendingInputBytes = 1
    const pendingInputPart = inactiveRecord('session::pending-input-part')
    pendingInputPart.pendingInput = [{ data: 'promised' }]
    const { byKey, pruner } = setup(
      [attached, live, spawning, terminating, pending, inFlight, pendingInput, pendingInputPart],
      { maxRecords: 0, maxScrollbackBytes: 0 },
      new Set([attached.key]),
    )

    expect(pruner.prune()).toEqual([])
    expect([...byKey.keys()]).toHaveLength(8)
  })

  it('evicts an inactive record after its final attachment and output are gone', () => {
    const record = inactiveRecord('session::main')
    record.pendingOutput = 'pending'
    record.pendingOutputBytes = 7
    const attached = new Set([record.key])
    const { byKey, pruner } = setup([record], { maxRecords: 0, maxScrollbackBytes: 0 }, attached)

    expect(pruner.prune()).toEqual([])
    attached.clear()
    expect(pruner.prune()).toEqual([])
    record.pendingOutput = ''
    record.pendingOutputBytes = 0

    expect(pruner.prune()).toEqual([record])
    expect(byKey.size).toBe(0)
  })
})
