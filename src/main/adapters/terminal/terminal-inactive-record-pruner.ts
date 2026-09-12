import { TERMINAL } from '@shared/constants/resource-limits'
import type { TerminalKey } from '@shared/types/terminal'
import type { TerminalRecord } from './terminal-records'

export interface TerminalInactiveRecordPrunerOptions {
  readonly records: ReadonlyMap<string, TerminalRecord>
  readonly isAttached: (key: TerminalKey) => boolean
  readonly evict: (record: TerminalRecord) => boolean
  readonly maxRecords?: number
  readonly maxScrollbackBytes?: number
}

export interface TerminalInactiveRecordPruner {
  readonly markActive: (record: TerminalRecord) => void
  readonly markInactive: (record: TerminalRecord) => void
  readonly prune: () => readonly TerminalRecord[]
}

function isInactive(record: TerminalRecord) {
  return (
    !record.closed &&
    record.live === null &&
    record.exitCode !== null &&
    record.termination === null
  )
}

function outputIsDrained(record: TerminalRecord) {
  return (
    record.pendingOutput.length === 0 &&
    record.pendingOutputBytes === 0 &&
    record.inFlightOutput === null &&
    record.pendingInput.length === 0 &&
    record.pendingInputBytes === 0
  )
}

export function makeTerminalInactiveRecordPruner(
  options: TerminalInactiveRecordPrunerOptions,
): TerminalInactiveRecordPruner {
  const maxRecords = options.maxRecords ?? TERMINAL.MAX_INACTIVE_RECORDS
  const maxScrollbackBytes = options.maxScrollbackBytes ?? TERMINAL.MAX_INACTIVE_SCROLLBACK_BYTES
  const inactiveOrder = new WeakMap<TerminalRecord, number>()
  let nextInactiveOrder = 0

  const markActive = (record: TerminalRecord) => {
    inactiveOrder.delete(record)
  }

  const markInactive = (record: TerminalRecord) => {
    if (inactiveOrder.has(record)) return
    nextInactiveOrder += 1
    inactiveOrder.set(record, nextInactiveOrder)
  }

  const prune = () => {
    const inactive: TerminalRecord[] = []
    let totalBytes = 0
    for (const record of options.records.values()) {
      if (!isInactive(record)) {
        markActive(record)
        continue
      }
      markInactive(record)
      inactive.push(record)
      totalBytes += record.scrollback.byteCount
    }

    let totalRecords = inactive.length
    if (totalRecords <= maxRecords && totalBytes <= maxScrollbackBytes) return []
    const candidates = inactive
      .filter(
        (record) =>
          record.ownerMigration === null &&
          !options.isAttached(record.key) &&
          outputIsDrained(record),
      )
      .sort((left, right) => {
        const byOrder = (inactiveOrder.get(left) ?? 0) - (inactiveOrder.get(right) ?? 0)
        return byOrder === 0 ? left.key.localeCompare(right.key) : byOrder
      })

    const evicted: TerminalRecord[] = []
    for (const record of candidates) {
      if (totalRecords <= maxRecords && totalBytes <= maxScrollbackBytes) break
      const retainedBytes = record.scrollback.byteCount
      if (!options.evict(record)) continue
      evicted.push(record)
      totalRecords -= 1
      totalBytes -= retainedBytes
      inactiveOrder.delete(record)
    }
    return evicted
  }

  return { markActive, markInactive, prune }
}
