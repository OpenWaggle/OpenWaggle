import { TERMINAL } from '@shared/constants/resource-limits'
import type { TerminalKey, TerminalOwnerKey } from '@shared/types/terminal'
import { createLogger } from '../../logger'
import {
  makeTerminalHistoryFiles,
  ownerKeyFromTerminalKey,
  type TerminalHistoryFiles,
} from './terminal-history-files'
import { makeTerminalHistoryMover, type TerminalHistoryMover } from './terminal-history-moves'
import { removeTerminalHistoryForPath } from './terminal-history-path-cleanup'
import {
  measureTerminalHistoryText,
  retainTerminalHistorySuffix,
  type TerminalHistoryCounts,
} from './terminal-history-retention'
import { stripTerminalReplaySequences } from './terminal-history-sanitizer'
import type {
  TerminalHistoryCacheSnapshot,
  TerminalHistoryStore,
} from './terminal-history-store-types'

export type { TerminalHistoryCacheSnapshot, TerminalHistoryStore }

const logger = createLogger('terminal-history')

const HISTORY_COMPACT_TARGET_PERCENT = 80
const PERCENT_BASE = 100
const HISTORY_COMPACT_TARGET_LINES = Math.floor(
  (TERMINAL.MAX_SCROLLBACK_LINES * HISTORY_COMPACT_TARGET_PERCENT) / PERCENT_BASE,
)
const HISTORY_COMPACT_TARGET_BYTES = Math.floor(
  (TERMINAL.MAX_SCROLLBACK_BYTES * HISTORY_COMPACT_TARGET_PERCENT) / PERCENT_BASE,
)

interface PendingBatch {
  parts: string[]
  bytes: number
  lines: number
}

const logMutationFailure = (error: unknown) => {
  logger.warn('Terminal history mutation failed', {
    error: error instanceof Error ? error.message : String(error),
  })
}

class TerminalHistoryStoreImpl implements TerminalHistoryStore {
  private flushTimer: NodeJS.Timeout | null = null
  private mutationTail: Promise<void> = Promise.resolve()
  private readonly pending = new Map<TerminalKey, PendingBatch>()
  private readonly states = new Map<TerminalKey, TerminalHistoryCounts>()
  private readonly workingDirectories = new Map<TerminalKey, string>()
  private readonly files: TerminalHistoryFiles
  private readonly mover: TerminalHistoryMover

  constructor(logsDir: string) {
    this.files = makeTerminalHistoryFiles(logsDir)
    this.mover = makeTerminalHistoryMover(this.files, this.states, this.workingDirectories)
  }

  async read(key: TerminalKey) {
    const pendingBarrier = this.queuePendingBatches()
    return this.enqueueMutation(async () => {
      await pendingBarrier
      return this.readPersisted(key)
    }).catch(() => '')
  }

  registerWorkingDirectory(key: TerminalKey, cwd: string) {
    this.workingDirectories.set(key, cwd)
    return this.enqueueMutation(async () => {
      await this.files.ensureDirectory()
      await this.files.ensureWorkingDirectory(key, cwd)
    })
  }

  append(key: TerminalKey, chunk: string) {
    if (chunk.length === 0) return
    const measured = measureTerminalHistoryText(chunk)
    const batch = this.pending.get(key) ?? { parts: [], bytes: 0, lines: 0 }
    batch.parts.push(chunk)
    batch.bytes += measured.bytes
    batch.lines += measured.lines
    this.retainPendingBatch(batch)
    this.pending.set(key, batch)
    this.scheduleFlush()
  }

  truncate(key: TerminalKey) {
    this.pending.delete(key)
    return this.enqueueMutation(async () => {
      await this.files.ensureDirectory()
      const files = await this.ensureHistoryFiles(key)
      await this.files.writePrivate(files.logFile, '')
      this.states.set(key, { bytes: 0, lines: 0 })
    })
  }

  remove(key: TerminalKey) {
    this.pending.delete(key)
    return this.enqueueMutation(async () => {
      const files = this.files.describe(key)
      await this.files.remove([files.logFile, files.metadataFile, files.workingDirectoryFile])
      this.states.delete(key)
      this.workingDirectories.delete(key)
    })
  }

  removeForOwner(ownerKey: TerminalOwnerKey) {
    for (const key of this.pending.keys()) {
      if (ownerKeyFromTerminalKey(key) === ownerKey) this.pending.delete(key)
    }
    return this.enqueueMutation(async () => {
      await this.files.ensureDirectory()
      const entries = await this.files.listOwnerEntries(ownerKey)
      await this.files.remove(entries.map((entry) => this.files.pathForEntry(entry)))
      for (const key of this.states.keys()) {
        if (ownerKeyFromTerminalKey(key) === ownerKey) this.states.delete(key)
      }
      for (const key of this.workingDirectories.keys()) {
        if (ownerKeyFromTerminalKey(key) === ownerKey) this.workingDirectories.delete(key)
      }
    })
  }

  removeForPath(directoryPath: string) {
    const pendingBarrier = this.queuePendingBatches()
    return this.enqueueMutation(async () => {
      await pendingBarrier
      await removeTerminalHistoryForPath(this.files, directoryPath, (key) => {
        this.pending.delete(key)
        this.states.delete(key)
        this.workingDirectories.delete(key)
      })
    })
  }

  move(fromKey: TerminalKey, toKey: TerminalKey) {
    if (fromKey === toKey) return Promise.resolve()
    return this.moveKeys(() => this.mover.move(fromKey, toKey))
  }

  moveOwner(fromOwnerKey: TerminalOwnerKey, toOwnerKey: TerminalOwnerKey) {
    if (fromOwnerKey === toOwnerKey) return Promise.resolve()
    return this.moveKeys(() => this.mover.moveOwner(fromOwnerKey, toOwnerKey))
  }

  release(key: TerminalKey) {
    const pendingBarrier = this.queuePendingBatches()
    return this.enqueueMutation(async () => {
      await pendingBarrier.catch(() => undefined)
      this.states.delete(key)
      this.workingDirectories.delete(key)
    })
  }

  async flush() {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    await this.queuePendingBatches()
  }

  cacheSnapshotForTests(): TerminalHistoryCacheSnapshot {
    return {
      states: [...this.states].map(([key, state]) => ({ key, ...state })),
      workingDirectories: [...this.workingDirectories].map(([key, cwd]) => ({ key, cwd })),
    }
  }
  private enqueueMutation<Result>(mutation: () => Promise<Result>): Promise<Result> {
    const result = this.mutationTail.then(mutation)
    this.mutationTail = result.then(
      () => undefined,
      (error: unknown) => logMutationFailure(error),
    )
    return result
  }

  private async readPersisted(key: TerminalKey) {
    await this.files.ensureDirectory()
    const files = this.files.describe(key)
    const metadata = await this.files.readIfPresent(files.metadataFile)
    if (metadata === null) return ''
    if (metadata !== key) throw new Error('Terminal history digest collision')
    const raw = (await this.files.readIfPresent(files.logFile)) ?? ''
    const retained = retainTerminalHistorySuffix(
      raw,
      TERMINAL.MAX_SCROLLBACK_LINES,
      TERMINAL.MAX_SCROLLBACK_BYTES,
    )
    if (retained.text !== raw) await this.files.writePrivate(files.logFile, retained.text)
    this.states.set(key, { bytes: retained.bytes, lines: retained.lines })
    return stripTerminalReplaySequences(retained.text)
  }

  private async loadState(key: TerminalKey) {
    const cached = this.states.get(key)
    if (cached !== undefined) return cached
    const files = await this.ensureHistoryFiles(key)
    const raw = (await this.files.readIfPresent(files.logFile)) ?? ''
    const retained = retainTerminalHistorySuffix(
      raw,
      TERMINAL.MAX_SCROLLBACK_LINES,
      TERMINAL.MAX_SCROLLBACK_BYTES,
    )
    if (retained.text !== raw) {
      await this.files.writePrivate(files.logFile, retained.text)
    }
    if (retained.text === raw && raw.length > 0) await this.files.makePrivate(files.logFile)
    this.states.set(key, { bytes: retained.bytes, lines: retained.lines })
    return retained
  }

  private async appendBatch(key: TerminalKey, batch: PendingBatch) {
    const chunk = batch.parts.join('')
    if (chunk.length === 0) return
    const files = await this.ensureHistoryFiles(key)
    const state = await this.loadState(key)
    if (
      state.lines + batch.lines <= TERMINAL.MAX_SCROLLBACK_LINES &&
      state.bytes + batch.bytes <= TERMINAL.MAX_SCROLLBACK_BYTES
    ) {
      await this.files.appendPrivate(files.logFile, chunk)
      this.states.set(key, {
        bytes: state.bytes + batch.bytes,
        lines: state.lines + batch.lines,
      })
      return
    }

    const existing = (await this.files.readIfPresent(files.logFile)) ?? ''
    const retained = retainTerminalHistorySuffix(
      existing + chunk,
      HISTORY_COMPACT_TARGET_LINES,
      HISTORY_COMPACT_TARGET_BYTES,
    )
    await this.files.writePrivate(files.logFile, retained.text)
    this.states.set(key, { bytes: retained.bytes, lines: retained.lines })
  }

  private retainPendingBatch(batch: PendingBatch) {
    if (
      batch.lines <= TERMINAL.MAX_SCROLLBACK_LINES &&
      batch.bytes <= TERMINAL.MAX_SCROLLBACK_BYTES
    ) {
      return
    }
    const retained = retainTerminalHistorySuffix(
      batch.parts.join(''),
      HISTORY_COMPACT_TARGET_LINES,
      HISTORY_COMPACT_TARGET_BYTES,
    )
    batch.parts = [retained.text]
    batch.bytes = retained.bytes
    batch.lines = retained.lines
  }

  private ensureHistoryFiles(key: TerminalKey) {
    const cwd = this.workingDirectories.get(key)
    return cwd === undefined
      ? this.files.ensureMetadata(key)
      : this.files.ensureWorkingDirectory(key, cwd)
  }

  private takePendingBatches() {
    const batches = [...this.pending.entries()]
    this.pending.clear()
    return batches
  }

  private queuePendingBatches() {
    const batches = this.takePendingBatches()
    if (batches.length === 0) return this.mutationTail
    return this.enqueueMutation(async () => {
      await this.files.ensureDirectory()
      await Promise.all(batches.map(([key, batch]) => this.appendBatch(key, batch)))
    })
  }

  private scheduleFlush() {
    if (this.flushTimer !== null) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.flush().catch(logMutationFailure)
    }, TERMINAL.HISTORY_FLUSH_MS)
  }

  private moveKeys(move: () => Promise<void>) {
    const pendingBarrier = this.queuePendingBatches()
    return this.enqueueMutation(async () => {
      await pendingBarrier
      await move()
    })
  }
}

export function makeTerminalHistoryStore(logsDir: string): TerminalHistoryStore {
  return new TerminalHistoryStoreImpl(logsDir)
}
