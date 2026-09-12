import { TERMINAL } from '@shared/constants/resource-limits'
import type {
  TerminalKey,
  TerminalOwnerKey,
  TerminalOwnerMigrationResult,
} from '@shared/types/terminal'
import { terminalKeyOf } from '@shared/types/terminal'
import * as Effect from 'effect/Effect'
import { ownerKeyFromTerminalKey } from './terminal-history-files'
import { replaceTerminalAlias } from './terminal-key-aliases'
import {
  blockTerminalOwner,
  enqueueTerminalScopeOperation,
  waitForTerminalOperations,
} from './terminal-operation-queue'
import type { TerminalRecord } from './terminal-records'
import type { TerminalActionContext } from './terminal-service-actions'

type PauseStates = Map<TerminalKey, boolean>

function recordsForOwner(context: TerminalActionContext, ownerKey: TerminalOwnerKey) {
  return [...context.runtime.records.values()].filter((record) => record.ownerKey === ownerKey)
}

function preflightMigration(
  context: TerminalActionContext,
  records: readonly TerminalRecord[],
  toOwnerKey: TerminalOwnerKey,
) {
  for (const record of records) {
    const destinationKey = terminalKeyOf(toOwnerKey, record.terminalId)
    if (context.runtime.records.has(destinationKey)) {
      throw new Error(`Cannot migrate terminal owner: destination ${destinationKey} exists.`)
    }
  }
}

function pauseForMigration(records: readonly TerminalRecord[], targetOwnerKey: TerminalOwnerKey) {
  const pauseStates: PauseStates = new Map()
  for (const record of records) {
    record.ownerMigration = { targetOwnerKey, historyBuffer: '' }
    const live = record.live
    if (live === null) continue
    pauseStates.set(record.key, live.outputPaused)
    if (live.outputPaused) continue
    live.pauseOutput()
    live.outputPaused = true
  }
  return pauseStates
}

function resumeAfterMigration(record: TerminalRecord, wasPaused: boolean) {
  const backlogBytes = record.pendingOutputBytes + (record.inFlightOutput?.byteLength ?? 0)
  const backlogStillPaused = wasPaused
    ? backlogBytes > TERMINAL.OUTPUT_BACKPRESSURE_LOW_WATER_BYTES
    : backlogBytes >= TERMINAL.OUTPUT_BACKPRESSURE_HIGH_WATER_BYTES
  if (backlogStillPaused || record.live?.outputPaused !== true) {
    return
  }
  record.live.resumeOutput()
  record.live.outputPaused = false
}

function restoreSourceRecords(
  context: TerminalActionContext,
  records: readonly TerminalRecord[],
  pauseStates: PauseStates,
) {
  for (const record of records) {
    const buffered = record.ownerMigration?.historyBuffer ?? ''
    record.ownerMigration = null
    context.runtime.history.append(record.key, buffered)
    resumeAfterMigration(record, pauseStates.get(record.key) ?? false)
  }
}

async function moveAttachments(
  context: TerminalActionContext,
  records: readonly TerminalRecord[],
  toOwnerKey: TerminalOwnerKey,
  movedRecords: TerminalRecord[],
) {
  for (const record of records) {
    await context.moveAttachments(record.key, terminalKeyOf(toOwnerKey, record.terminalId))
    movedRecords.push(record)
  }
}

async function rollbackMigration(
  context: TerminalActionContext,
  movedRecords: readonly TerminalRecord[],
  fromOwnerKey: TerminalOwnerKey,
  toOwnerKey: TerminalOwnerKey,
  historyMoved: boolean,
) {
  const rollbackErrors: unknown[] = []
  for (const record of [...movedRecords].reverse()) {
    try {
      await context.moveAttachments(
        terminalKeyOf(toOwnerKey, record.terminalId),
        terminalKeyOf(fromOwnerKey, record.terminalId),
      )
    } catch (error) {
      rollbackErrors.push(error)
    }
  }
  if (historyMoved) {
    try {
      await context.runtime.history.moveOwner(toOwnerKey, fromOwnerKey)
    } catch (error) {
      rollbackErrors.push(error)
    }
  }
  return rollbackErrors
}

function rekeyRecords(
  context: TerminalActionContext,
  records: readonly TerminalRecord[],
  toOwnerKey: TerminalOwnerKey,
  pauseStates: PauseStates,
) {
  for (const record of records) {
    const oldKey = record.key
    const newKey = terminalKeyOf(toOwnerKey, record.terminalId)
    const buffered = record.ownerMigration?.historyBuffer ?? ''
    context.runtime.records.delete(oldKey)
    record.key = newKey
    record.ownerKey = toOwnerKey
    record.ownerMigration = null
    context.runtime.records.set(newKey, record)
    context.runtime.rekeyRecord(oldKey, newKey)
    replaceTerminalAlias(context.terminalKeyAliases, oldKey, newKey)
    context.runtime.history.append(newKey, buffered)
    resumeAfterMigration(record, pauseStates.get(oldKey) ?? false)
  }
}

async function migrateOwner(
  context: TerminalActionContext,
  fromOwnerKey: TerminalOwnerKey,
  toOwnerKey: TerminalOwnerKey,
): Promise<TerminalOwnerMigrationResult> {
  const sourceRecords = recordsForOwner(context, fromOwnerKey)
  if (fromOwnerKey === toOwnerKey) {
    return { terminalIds: sourceRecords.map((record) => record.terminalId) }
  }
  preflightMigration(context, sourceRecords, toOwnerKey)
  const pauseStates = pauseForMigration(sourceRecords, toOwnerKey)
  const movedRecords: TerminalRecord[] = []
  let historyMoved = false
  context.runtime.flushOutputs()
  await context.runtime.history.flush()

  try {
    await context.runtime.history.moveOwner(fromOwnerKey, toOwnerKey)
    historyMoved = true
    await moveAttachments(context, sourceRecords, toOwnerKey, movedRecords)
  } catch (error) {
    const rollbackErrors = await rollbackMigration(
      context,
      movedRecords,
      fromOwnerKey,
      toOwnerKey,
      historyMoved,
    )
    restoreSourceRecords(context, sourceRecords, pauseStates)
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        rollbackErrors,
        'Terminal owner migration and rollback both failed.',
        { cause: error },
      )
    }
    throw error
  }

  // All in-memory keys change in one synchronous turn. No caller can observe
  // only part of a multi-terminal owner migration.
  rekeyRecords(context, sourceRecords, toOwnerKey, pauseStates)
  context.onRecordsRekeyed()
  return { terminalIds: sourceRecords.map((record) => record.terminalId) }
}

export function migrateTerminalOwnerAction(
  context: TerminalActionContext,
  fromOwnerKey: TerminalOwnerKey,
  toOwnerKey: TerminalOwnerKey,
) {
  return Effect.promise(async () => {
    if (fromOwnerKey === toOwnerKey) return migrateOwner(context, fromOwnerKey, toOwnerKey)
    const releaseSource = blockTerminalOwner(context.operationQueue, fromOwnerKey, 'retry')
    const releaseDestination = blockTerminalOwner(context.operationQueue, toOwnerKey, 'retry')
    try {
      return await enqueueTerminalScopeOperation(context.operationQueue, async () => {
        await waitForTerminalOperations(context.operationQueue, (key) => {
          const ownerKey = ownerKeyFromTerminalKey(key)
          return ownerKey === fromOwnerKey || ownerKey === toOwnerKey
        })
        return migrateOwner(context, fromOwnerKey, toOwnerKey)
      })
    } finally {
      releaseDestination()
      releaseSource()
    }
  })
}
