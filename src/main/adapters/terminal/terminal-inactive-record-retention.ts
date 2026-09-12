import type { TerminalKey } from '@shared/types/terminal'
import { createLogger } from '../../logger'
import type { TerminalAttachmentTracker } from './terminal-attachment-tracker'
import { createTerminalHistorySanitizer } from './terminal-history-sanitizer'
import { makeTerminalInactiveRecordPruner } from './terminal-inactive-record-pruner'
import type { PendingTerminalInput } from './terminal-input-idempotency'
import { pruneTerminalAliasesForKey } from './terminal-key-aliases'
import type { TerminalRecord } from './terminal-records'
import type { TerminalRuntime } from './terminal-runtime'

const logger = createLogger('terminal-retention')

interface TerminalInactiveRecordRetentionOptions {
  readonly runtime: TerminalRuntime
  readonly attachments: TerminalAttachmentTracker
  readonly aliases: Map<TerminalKey, TerminalKey>
  readonly pendingInputByKey: Map<TerminalKey, PendingTerminalInput>
  readonly onRecordsChanged: () => void
  readonly maxRecords?: number
  readonly maxScrollbackBytes?: number
}

function releaseRecordMemory(record: TerminalRecord) {
  record.closed = true
  record.pendingInput = []
  record.pendingInputBytes = 0
  record.inputGeneration = null
  record.lastInputReceipt = null
  record.promptDetector = null
  record.promptEpoch = 0
  record.projectAction = null
  record.activity = null
  record.ownerMigration = null
  record.scrollback.reset()
  record.sanitizer = createTerminalHistorySanitizer()
}

export function makeTerminalInactiveRecordRetention(
  options: TerminalInactiveRecordRetentionOptions,
) {
  const evict = (record: TerminalRecord) => {
    if (options.runtime.records.get(record.key) !== record) return false
    if (options.runtime.hasDetachedProcesses(record)) return false
    options.runtime.discardPendingOutput(record.key)
    options.runtime.records.delete(record.key)
    options.pendingInputByKey.delete(record.key)
    pruneTerminalAliasesForKey(options.aliases, record.key)
    options.attachments.forget(record.key)
    releaseRecordMemory(record)
    void options.runtime.history.release(record.key).catch((error: unknown) => {
      logger.warn('Inactive terminal history cache release failed', {
        key: record.key,
        error: error instanceof Error ? error.message : String(error),
      })
    })
    return true
  }

  const pruner = makeTerminalInactiveRecordPruner({
    records: options.runtime.records,
    isAttached: options.attachments.isAttached,
    evict,
    ...(options.maxRecords === undefined ? {} : { maxRecords: options.maxRecords }),
    ...(options.maxScrollbackBytes === undefined
      ? {}
      : { maxScrollbackBytes: options.maxScrollbackBytes }),
  })

  const prune = () => {
    const evicted = pruner.prune()
    if (evicted.length > 0) options.onRecordsChanged()
  }

  return {
    markActive: pruner.markActive,
    markInactive: (record: TerminalRecord) => {
      pruner.markInactive(record)
      prune()
    },
    outputDrained: () => prune(),
    prune,
  }
}
