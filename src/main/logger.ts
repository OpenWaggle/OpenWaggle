import fs from 'node:fs'
import { mkdir, readdir, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import {
  HOURS_PER_DAY,
  MILLISECONDS_PER_SECOND,
  SECONDS_PER_MINUTE,
} from '@shared/constants/constants'
import type { Logger } from '@shared/types/logger'

const SLICE_ARG_1 = 11
const SLICE_ARG_2 = 23
const SLICE_ARG_2_VALUE_10 = 10
const FILE_LOGGER_FALLBACK_PREFIX = '[file-logger]'

export type { Logger }

function formatLine(namespace: string, message: string, data?: object): string {
  const ts = new Date().toISOString().slice(SLICE_ARG_1, SLICE_ARG_2) // HH:mm:ss.mmm
  if (data && Object.keys(data).length > 0) {
    return `${ts} [${namespace}] ${message} ${JSON.stringify(data)}`
  }
  return `${ts} [${namespace}] ${message}`
}

function reportFileLoggerFailure(message: string, error: unknown): void {
  const errorMessage = error instanceof Error ? error.message : String(error)
  try {
    process.stderr.write(`${FILE_LOGGER_FALLBACK_PREFIX} ${message}: ${errorMessage}\n`)
  } catch {
    // Ignore stderr failures to keep logging side effects non-fatal.
  }
}

// --- File writer (injected logsDir, async buffered writes) ---

const LOG_RETENTION_DAYS = 3

class FileWriter {
  private logsDir: string | null = null
  private currentDate: string | null = null
  private currentPath: string | null = null
  private buffer: string[] = []
  private flushScheduled = false

  async init(logsDir: string): Promise<void> {
    try {
      await mkdir(logsDir, { recursive: true })
      this.logsDir = logsDir
      this.currentDate = null
      this.currentPath = null
      this.ensureDatePath()
      await this.pruneOldLogs()
    } catch (error) {
      reportFileLoggerFailure('failed to initialize log directory', error)
    }
  }

  write(line: string): void {
    if (!this.logsDir) return
    this.ensureDatePath()
    this.buffer.push(line)
    if (!this.flushScheduled) {
      this.flushScheduled = true
      process.nextTick(() => this.flush())
    }
  }

  getLogFilePath(): string {
    return this.currentPath ?? ''
  }

  private ensureDatePath(): void {
    const dateStr = new Date().toISOString().slice(0, SLICE_ARG_2_VALUE_10) // YYYY-MM-DD
    if (dateStr === this.currentDate) return
    this.currentDate = dateStr
    this.currentPath = path.join(this.logsDir ?? '', `openwaggle-${dateStr}.log`)
  }

  private flush(): void {
    this.flushScheduled = false
    if (!this.currentPath || this.buffer.length === 0) return
    const batch = `${this.buffer.join('\n')}\n`
    this.buffer.length = 0
    fs.appendFile(this.currentPath, batch, (error) => {
      if (error) {
        reportFileLoggerFailure('failed to append log batch', error)
      }
    })
  }

  private async pruneOldLogs(): Promise<void> {
    if (!this.logsDir) return
    const logsDir = this.logsDir
    try {
      const cutoff =
        Date.now() -
        LOG_RETENTION_DAYS *
          HOURS_PER_DAY *
          SECONDS_PER_MINUTE *
          SECONDS_PER_MINUTE *
          MILLISECONDS_PER_SECOND
      const entries = await readdir(logsDir)
      const deletions = entries
        .filter((entry) => entry.startsWith('openwaggle-') && entry.endsWith('.log'))
        .map(async (entry) => {
          const filePath = path.join(logsDir, entry)
          const st = await stat(filePath)
          if (st.mtimeMs < cutoff) {
            await unlink(filePath)
          }
        })
      await Promise.allSettled(deletions)
    } catch (error) {
      reportFileLoggerFailure('failed to prune old log files', error)
    }
  }
}

const fileWriter = new FileWriter()

/**
 * Call once from index.ts after app.whenReady() to enable file logging.
 * Returns a promise that resolves when directory creation and log pruning complete.
 * Callers may ignore the return value for fire-and-forget initialization.
 */
export function initFileLogger(logsDir: string): Promise<void> {
  return fileWriter.init(logsDir)
}

export function getLogFilePath(): string {
  return fileWriter.getLogFilePath()
}

export function createLogger(namespace: string): Logger {
  return {
    debug(message, data) {
      const line = formatLine(namespace, message, data)
      console.debug(line)
      fileWriter.write(line)
    },
    info(message, data) {
      const line = formatLine(namespace, message, data)
      console.info(line)
      fileWriter.write(line)
    },
    warn(message, data) {
      const line = formatLine(namespace, message, data)
      console.warn(line)
      fileWriter.write(line)
    },
    error(message, data) {
      const line = formatLine(namespace, message, data)
      console.error(line)
      fileWriter.write(line)
    },
  }
}
