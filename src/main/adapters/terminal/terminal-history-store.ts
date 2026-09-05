import { promises as fs } from 'node:fs'
import path from 'node:path'
import { TERMINAL } from '@shared/constants/resource-limits'
import type { TerminalKey, TerminalOwnerKey } from '@shared/types/terminal'
import { createLogger } from '../../logger'

const logger = createLogger('terminal-history')

const LOG_FILE_EXTENSION_LENGTH = 4
const CHAR_CODE_LINE_FEED = 10
/**
 * Compaction slack: the file may run to these multiples of the scrollback
 * caps before being rewritten to the newest cap, so bursts cost one rewrite
 * per ~cap/4 lines (or ~cap/4 bytes) instead of per append.
 */
const HISTORY_COMPACT_LINE_THRESHOLD = Math.floor(TERMINAL.MAX_SCROLLBACK_LINES * 1.25)
const HISTORY_COMPACT_BYTE_THRESHOLD = Math.floor(TERMINAL.MAX_SCROLLBACK_BYTES * 1.25)

/**
 * Persisted scrollback for Session terminals (ADR 0030): one log per terminal
 * under `userData/terminal-logs/`, written through a coalescing worker so
 * bursty output does not hammer the disk, compacted to the newest
 * MAX_SCROLLBACK_LINES lines (and MAX_SCROLLBACK_BYTES bytes — progress-bar
 * output that never emits a newline would otherwise grow without bound), and
 * replayed on attach so a terminal restores its visual state after hide,
 * reload, or app restart. Per-key write chains serialize every mutation so a
 * concurrent append can never be clobbered by a compaction rewrite.
 */
export interface TerminalHistoryStore {
  /** Read the persisted scrollback for one terminal (empty when absent). */
  read(key: TerminalKey): Promise<string>
  /** Queue an (already sanitized) chunk for coalesced append. */
  append(key: TerminalKey, chunk: string): void
  /** Drop persisted scrollback, keeping the terminal's file for future appends. */
  truncate(key: TerminalKey): void
  /** Delete one terminal's persisted scrollback. */
  remove(key: TerminalKey): void
  /** Delete every terminal's scrollback for one owner (session delete). */
  removeForOwner(ownerKey: TerminalOwnerKey): void
  /** Flush pending appends immediately; called on shutdown. */
  flush(): Promise<void>
}

/** Canonical log-file location for one terminal key. */
const fileFor = (logsDir: string, key: TerminalKey) =>
  path.join(logsDir, `${Buffer.from(key, 'utf8').toString('base64url')}.log`)

const countLines = (chunk: string) => {
  let count = 0
  for (let index = 0; index < chunk.length; index += 1) {
    if (chunk.charCodeAt(index) === CHAR_CODE_LINE_FEED) count += 1
  }
  return count
}

/** Rewrite one terminal's log down to the newest scrollback caps. */
async function compactFile(file: string): Promise<void> {
  const content = await fs.readFile(file, 'utf8')
  const lines = content.split('\n')
  let keptBytes = 0
  let cut = lines.length
  while (cut > 0) {
    const nextIndex = cut - 1
    const lineBytes = Buffer.byteLength(lines[nextIndex], 'utf8') + 1
    const overLines = lines.length - nextIndex > TERMINAL.MAX_SCROLLBACK_LINES
    const overBytes = keptBytes + lineBytes > TERMINAL.MAX_SCROLLBACK_BYTES
    if (overLines || overBytes) break
    keptBytes += lineBytes
    cut = nextIndex
  }
  if (cut > 0) await fs.writeFile(file, lines.slice(cut).join('\n'), 'utf8')
}

type WriteEnqueue = (key: TerminalKey, mutation: () => Promise<void>) => Promise<void>

/** Delete every history file (and counter) whose key belongs to one owner. */
async function removeOwnerFiles(
  logsDir: string,
  ownerKey: TerminalOwnerKey,
  enqueue: WriteEnqueue,
  appendedLines: Map<TerminalKey, number>,
  appendedBytes: Map<TerminalKey, number>,
): Promise<void> {
  const prefix = `${ownerKey}::`
  const entries = await fs.readdir(logsDir).catch((): string[] => [])
  await Promise.all(
    entries
      .filter((entry) => entry.endsWith('.log'))
      .map((entry) => {
        const decoded = Buffer.from(
          entry.slice(0, entry.length - LOG_FILE_EXTENSION_LENGTH),
          'base64url',
        ).toString('utf8')
        if (!decoded.startsWith(prefix)) return Promise.resolve()
        appendedLines.delete(decoded)
        appendedBytes.delete(decoded)
        return enqueue(decoded, async () => {
          await fs.rm(path.join(logsDir, entry), { force: true })
        })
      }),
  )
}

/** Chains per-key file mutations so an append can never be clobbered by a compaction. */
function makeWriteEnqueue(chains: Map<TerminalKey, Promise<void>>) {
  return (key: TerminalKey, mutation: () => Promise<void>): Promise<void> => {
    const chained = chains.get(key)?.then(mutation, mutation) ?? mutation()
    const settled = chained.catch((error: unknown) => {
      logger.warn('Terminal history mutation failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    })
    chains.set(
      key,
      settled.finally(() => {
        if (chains.get(key) === settled) chains.delete(key)
      }),
    )
    return chained
  }
}

export function makeTerminalHistoryStore(logsDir: string): TerminalHistoryStore {
  let directoryReady = false
  let flushTimer: NodeJS.Timeout | null = null
  const pending = new Map<TerminalKey, string>()
  /** Lines and bytes appended since the last compaction of that key. */
  const appendedLines = new Map<TerminalKey, number>()
  const appendedBytes = new Map<TerminalKey, number>()
  /** Serializes every file mutation per key. */
  const writeChains = new Map<TerminalKey, Promise<void>>()
  const enqueue = makeWriteEnqueue(writeChains)

  const ensureDirectory = async () => {
    if (directoryReady) return
    await fs.mkdir(logsDir, { recursive: true })
    directoryReady = true
  }

  const flush = async (): Promise<void> => {
    if (pending.size > 0) {
      const batches = [...pending.entries()]
      pending.clear()
      try {
        await ensureDirectory()
        await Promise.all(batches.map(([key, chunk]) => appendBatch(key, chunk)))
      } catch (error) {
        logger.warn('Failed to persist terminal scrollback', {
          error: error instanceof Error ? error.message : String(error),
          terminals: batches.length,
        })
      }
    }
    // Barrier: callers (shutdown, truncate visibility) must be able to rely on
    // every already-enqueued mutation having completed, not just the appends.
    await Promise.all([...writeChains.values()])
  }

  // Runs inside the key's write chain, so the compaction is serialized with
  // the append it follows and can never clobber a concurrent batch.
  const appendBatch = (key: TerminalKey, chunk: string): Promise<void> =>
    enqueue(key, async () => {
      await fs.appendFile(fileFor(logsDir, key), chunk, 'utf8')
      const overLines = (appendedLines.get(key) ?? 0) > HISTORY_COMPACT_LINE_THRESHOLD
      const overBytes = (appendedBytes.get(key) ?? 0) > HISTORY_COMPACT_BYTE_THRESHOLD
      if (!overLines && !overBytes) return
      await compactFile(fileFor(logsDir, key))
      appendedLines.set(key, 0)
      appendedBytes.set(key, 0)
    })

  const scheduleFlush = () => {
    if (flushTimer !== null) return
    flushTimer = setTimeout(() => {
      flushTimer = null
      void flush()
    }, TERMINAL.HISTORY_FLUSH_MS)
  }

  return {
    async read(key) {
      try {
        return await fs.readFile(fileFor(logsDir, key), 'utf8')
      } catch {
        return ''
      }
    },
    append(key, chunk) {
      if (chunk.length === 0) return
      pending.set(key, (pending.get(key) ?? '') + chunk)
      appendedLines.set(key, (appendedLines.get(key) ?? 0) + countLines(chunk))
      appendedBytes.set(key, (appendedBytes.get(key) ?? 0) + Buffer.byteLength(chunk, 'utf8'))
      scheduleFlush()
    },
    truncate(key) {
      pending.delete(key)
      appendedLines.set(key, 0)
      appendedBytes.set(key, 0)
      scheduleFlush()
      void enqueue(key, () => fs.writeFile(fileFor(logsDir, key), '', 'utf8'))
    },
    remove(key) {
      pending.delete(key)
      appendedLines.delete(key)
      appendedBytes.delete(key)
      void enqueue(key, async () => {
        await fs.rm(fileFor(logsDir, key), { force: true })
      })
    },
    removeForOwner(ownerKey) {
      void (async () => {
        await flush()
        await removeOwnerFiles(logsDir, ownerKey, enqueue, appendedLines, appendedBytes)
      })()
    },
    flush: () => {
      return flush()
    },
  }
}
