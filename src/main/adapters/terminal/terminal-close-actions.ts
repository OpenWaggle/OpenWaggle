import type { TerminalCloseAssessment } from '@shared/types/terminal'
import { terminalKeyOf } from '@shared/types/terminal'
import * as Effect from 'effect/Effect'
import { ownerKeyFromTerminalKey } from './terminal-history-files'
import { pruneTerminalAliasesForKey, pruneTerminalAliasesForOwner } from './terminal-key-aliases'
import {
  blockAllTerminals,
  blockTerminalKey,
  blockTerminalOwner,
  blockTerminalPath,
  enqueueTerminalOperation,
  enqueueTerminalScopeOperation,
  isTerminalPathWithin,
  terminalOperationBlockDisposition,
  waitForTerminalOperations,
  waitForTerminalScopeOperation,
} from './terminal-operation-queue'
import type { TerminalRecord } from './terminal-records'
import { resolveTerminalKey, type TerminalActionContext } from './terminal-service-actions'

export function assessTerminalCloseAction(
  context: TerminalActionContext,
  ownerKey: string,
  terminalId: string,
) {
  return Effect.sync((): TerminalCloseAssessment => {
    const key = resolveTerminalKey(context, terminalKeyOf(ownerKey, terminalId))
    const record = context.runtime.records.get(key)
    if (
      record === undefined ||
      (record.live === null && !context.runtime.hasDetachedProcesses(record))
    ) {
      return { disposition: 'safe', reason: 'dead' }
    }
    if (record.activity === null) {
      return {
        disposition: 'confirm',
        reason: 'uncertain',
        processNames: [],
        ports: [],
      }
    }
    if (record.activity.processNames.length > 0 || record.activity.ports.length > 0) {
      return {
        disposition: 'confirm',
        reason: 'active',
        processNames: record.activity.processNames,
        ports: record.activity.ports,
      }
    }
    if (!record.activity.reliable) {
      return {
        disposition: 'confirm',
        reason: 'uncertain',
        processNames: [],
        ports: [],
      }
    }
    return { disposition: 'safe', reason: 'idle' }
  })
}

export function closeTerminalAction(
  context: TerminalActionContext,
  ownerKey: string,
  terminalId: string,
  deleteHistory: boolean,
): Effect.Effect<void> {
  return Effect.promise(async () => {
    const requestedKey = terminalKeyOf(ownerKey, terminalId)
    const key = resolveTerminalKey(context, requestedKey)
    const record = context.runtime.records.get(key)
    const blockDisposition = terminalOperationBlockDisposition(context.operationQueue, {
      key,
      ownerKey: record?.ownerKey ?? ownerKey,
      cwd: record?.cwd,
    })
    if (blockDisposition === 'retry') {
      await waitForTerminalScopeOperation(context.operationQueue)
      await Effect.runPromise(closeTerminalAction(context, ownerKey, terminalId, deleteHistory))
      return
    }
    if (blockDisposition === 'cancel') {
      await waitForTerminalOperations(context.operationQueue, (candidate) => candidate === key)
      return
    }
    const release = blockTerminalKey(context.operationQueue, key)
    try {
      await enqueueTerminalOperation(
        context.operationQueue,
        key,
        async () => {
          const currentKey = resolveTerminalKey(context, requestedKey)
          const current = context.runtime.records.get(currentKey)
          if (current === undefined) {
            context.pendingInputByKey.delete(currentKey)
            context.pendingInputByKey.delete(requestedKey)
            if (deleteHistory) await context.runtime.history.remove(currentKey)
            pruneTerminalAliasesForKey(context.terminalKeyAliases, currentKey)
            pruneTerminalAliasesForKey(context.terminalKeyAliases, requestedKey)
          } else {
            await closeRecord(context, current, deleteHistory)
          }
          if (deleteHistory) await context.runtime.history.flush()
        },
        record?.cwd,
      )
    } finally {
      release()
    }
  })
}

export function closeOwnerTerminalsAction(
  context: TerminalActionContext,
  ownerKey: string,
  deleteHistory: boolean,
) {
  return Effect.promise(async () => {
    const { runtime } = context
    const release = blockTerminalOwner(context.operationQueue, ownerKey)
    try {
      await enqueueTerminalScopeOperation(context.operationQueue, async () => {
        await waitForTerminalOperations(
          context.operationQueue,
          (key) => ownerKeyFromTerminalKey(key) === ownerKey,
        )
        const ownerRecords = [...runtime.records.values()].filter(
          (record) => record.ownerKey === ownerKey,
        )
        await stopRecordsForDestructiveClose(runtime, ownerRecords)
        await proveRetainedProcessTreesStopped(runtime, ownerRecords)
        for (const record of ownerRecords)
          await finalizeClosedRecord(context, record, deleteHistory)
        for (const key of [...context.pendingInputByKey.keys()]) {
          if (ownerKeyFromTerminalKey(key) === ownerKey) context.pendingInputByKey.delete(key)
        }
        pruneTerminalAliasesForOwner(context.terminalKeyAliases, ownerKey)
        if (deleteHistory) {
          await runtime.history.removeForOwner(ownerKey)
          await runtime.history.flush()
        }
      })
    } finally {
      release()
    }
  })
}

export function closeTerminalsUnderPathAction(
  context: TerminalActionContext,
  directoryPath: string,
  deleteHistory: boolean,
) {
  return Effect.promise(async () => {
    const { runtime } = context
    const release = blockTerminalPath(context.operationQueue, directoryPath)
    try {
      await enqueueTerminalScopeOperation(context.operationQueue, async () => {
        await waitForTerminalOperations(context.operationQueue, (key) => {
          const admittedCwds = context.operationQueue.operationCwds.get(key)
          if (
            admittedCwds !== undefined &&
            [...admittedCwds].some((cwd) => isTerminalPathWithin(cwd, directoryPath))
          ) {
            return true
          }
          const recordCwd = context.runtime.records.get(key)?.cwd
          return recordCwd !== undefined && isTerminalPathWithin(recordCwd, directoryPath)
        })
        const pathRecords = [...runtime.records.values()].filter((record) =>
          isTerminalPathWithin(record.cwd, directoryPath),
        )
        await stopRecordsForDestructiveClose(runtime, pathRecords)
        await proveRetainedProcessTreesStopped(runtime, pathRecords)
        for (const record of pathRecords) await finalizeClosedRecord(context, record, deleteHistory)
        if (deleteHistory) {
          await runtime.history.removeForPath(directoryPath)
          await runtime.history.flush()
        }
      })
    } finally {
      release()
    }
  })
}

export function closeAllTerminalsAction(context: TerminalActionContext) {
  return Effect.promise(async () => {
    const { runtime } = context
    const release = blockAllTerminals(context.operationQueue)
    try {
      await enqueueTerminalScopeOperation(context.operationQueue, async () => {
        await waitForTerminalOperations(context.operationQueue, () => true)
        runtime.flushOutputs()
        const records = [...runtime.records.values()]
        const results = await Promise.allSettled(
          records.map(async (record) => {
            if (!(await runtime.killLive(record))) {
              throw new Error(`Terminal process ${record.key} could not be stopped.`)
            }
            return record
          }),
        )
        const failures: unknown[] = []
        const stoppedRecords: TerminalRecord[] = []
        for (const [index, result] of results.entries()) {
          if (result.status === 'rejected') {
            failures.push(result.reason)
            continue
          }
          const record = records[index]
          if (record === undefined) continue
          stoppedRecords.push(record)
        }
        const resourcesDrained = await runtime.shutdownDetachedProcesses()
        if (!resourcesDrained) {
          failures.push(new Error('One or more retained stale terminal processes could not stop.'))
        } else {
          for (const record of stoppedRecords) {
            record.closed = true
            runtime.discardPendingOutput(record.key)
            runtime.records.delete(record.key)
            context.pendingInputByKey.delete(record.key)
            pruneTerminalAliasesForKey(context.terminalKeyAliases, record.key)
          }
        }
        try {
          await runtime.history.flush()
        } catch (error) {
          failures.push(error)
        }
        if (failures.length > 0) {
          throw new AggregateError(failures, 'Terminal shutdown did not complete.')
        }
        context.pendingInputByKey.clear()
        context.terminalKeyAliases.clear()
      })
    } finally {
      release()
    }
  })
}

async function closeRecord(
  context: TerminalActionContext,
  record: TerminalRecord,
  deleteHistory: boolean,
) {
  const { runtime } = context
  if (!(await runtime.killLive(record))) throw new Error('Terminal process could not be stopped.')
  if (!(await runtime.shutdownDetachedProcesses([record]))) {
    throw new Error('Terminal output and native resources did not finish draining.')
  }
  await finalizeClosedRecord(context, record, deleteHistory)
}

async function stopRecordsForDestructiveClose(
  runtime: TerminalActionContext['runtime'],
  records: readonly TerminalRecord[],
) {
  const results = await Promise.allSettled(records.map((record) => runtime.killLive(record)))
  const failures = results.flatMap((result, index) => {
    if (result.status === 'rejected') {
      const reason: unknown = result.reason
      return [reason]
    }
    if (result.value) return []
    return [new Error(`Terminal process ${records[index]?.key ?? index} could not be stopped.`)]
  })
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Terminal process shutdown did not complete.')
  }
}

async function proveRetainedProcessTreesStopped(
  runtime: TerminalActionContext['runtime'],
  records: readonly TerminalRecord[],
) {
  if (await runtime.shutdownDetachedProcessTrees(records)) return
  throw new Error('One or more retained terminal process trees could not be stopped.')
}

async function finalizeClosedRecord(
  context: TerminalActionContext,
  record: TerminalRecord,
  deleteHistory: boolean,
) {
  const { runtime } = context
  if (deleteHistory) await runtime.history.remove(record.key)
  else await runtime.history.release(record.key)
  record.closed = true
  runtime.discardPendingOutput(record.key)
  runtime.records.delete(record.key)
  pruneTerminalAliasesForKey(context.terminalKeyAliases, record.key)
  context.pendingInputByKey.delete(record.key)
  runtime.emitEvent(record, { type: 'closed' })
}
