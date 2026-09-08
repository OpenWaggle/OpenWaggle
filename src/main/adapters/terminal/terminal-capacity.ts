import { TERMINAL } from '@shared/constants/resource-limits'
import type { TerminalKey } from '@shared/types/terminal'
import { ownerKeyFromTerminalKey } from './terminal-history-files'
import type { TerminalRuntime } from './terminal-runtime'

interface TerminalCapacityContext {
  readonly runtime: Pick<TerminalRuntime, 'records'>
  readonly inFlightOpens: ReadonlyMap<TerminalKey, Promise<unknown>>
}

export function assertTerminalRecordCapacity(
  context: TerminalCapacityContext,
  key: TerminalKey,
  ownerKey: string,
) {
  if (context.runtime.records.has(key) || context.inFlightOpens.has(key)) return
  const reservedKeys = [...context.inFlightOpens.keys()].filter(
    (candidate) => !context.runtime.records.has(candidate),
  )
  if (context.runtime.records.size + reservedKeys.length >= TERMINAL.MAX_TERMINAL_RECORDS) {
    throw new Error(
      `Terminal capacity reached (${String(TERMINAL.MAX_TERMINAL_RECORDS)} across the application). Close an unused terminal and retry.`,
    )
  }
  const ownerRecords = [...context.runtime.records.values()].filter(
    (record) => record.ownerKey === ownerKey,
  ).length
  const ownerReservations = reservedKeys.filter(
    (candidate) => ownerKeyFromTerminalKey(candidate) === ownerKey,
  ).length
  if (ownerRecords + ownerReservations >= TERMINAL.MAX_TERMINALS_PER_OWNER) {
    throw new Error(
      `Terminal capacity reached (${String(TERMINAL.MAX_TERMINALS_PER_OWNER)} for this session). Close an unused terminal and retry.`,
    )
  }
}
