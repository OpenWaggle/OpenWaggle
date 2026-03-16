import fs from 'node:fs'
import { mkdir, readdir, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import {
  HOURS_PER_DAY,
  MILLISECONDS_PER_SECOND,
  SECONDS_PER_MINUTE,
} from '@shared/constants/constants'
import type { Logger, LogLevel } from '@shared/types/logger'
import { logLevel as configuredLogLevel } from './env'

const SLICE_ARG_1 = 11
const SLICE_ARG_2 = 23
const SLICE_ARG_2_VALUE_10 = 10
const FILE_LOGGER_FALLBACK_PREFIX = '[file-logger]'

const LOG_LEVEL_PRIORITIES: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

interface LogEntry {
  readonly namespace: string
  readonly level: LogLevel
  readonly message: string
  readonly data?: object
}

export type { Logger, LogLevel }

function safeSerialize(data: object): string {
  try {
    return JSON.stringify(data)
  } catch {
    return '[unserializable data]'
  }
}

function formatLine(entry: LogEntry): string {
  const ts = new Date().toISOString().slice(SLICE_ARG_1, SLICE_ARG_2) // HH:mm:ss.mmm
  if (entry.data && Object.keys(entry.data).length > 0) {
    return `${ts} [${entry.namespace}] ${entry.message} ${safeSerialize(entry.data)}`
  }
  return `${ts} [${entry.namespace}] ${entry.message}`
}

function isLevelEnabled(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITIES[level] >= LOG_LEVEL_PRIORITIES[configuredLogLevel]
}

function writeToConsole(entry: LogEntry): void {
  const ts = new Date().toISOString().slice(SLICE_ARG_1, SLICE_ARG_2) // HH:mm:ss.mmm
  const prefix = `${ts} [${entry.namespace}] ${entry.message}`
  const consoleMethod = {
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
  }[entry.level]

  if (entry.data && Object.keys(entry.data).length > 0) {
    consoleMethod(prefix, entry.data)
    return
  }

  consoleMethod(prefix)
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
  private buffer: LogEntry[] = []
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

  write(entry: LogEntry): void {
    if (!this.logsDir) return
    this.buffer.push(entry)
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
    if (this.buffer.length === 0) return
    this.ensureDatePath()
    if (!this.currentPath) return
    const batchEntries = this.buffer.splice(0)
    const batch = `${batchEntries.map((entry) => formatLine(entry)).join('\n')}\n`
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
  const log = (level: LogLevel, message: string, data?: object): void => {
    if (!isLevelEnabled(level)) {
      return
    }

    const entry: LogEntry = { namespace, level, message, data }
    writeToConsole(entry)
    fileWriter.write(entry)
  }

  return {
    isLevelEnabled,
    isDebugEnabled() {
      return isLevelEnabled('debug')
    },
    debug(message, data) {
      log('debug', message, data)
    },
    info(message, data) {
      log('info', message, data)
    },
    warn(message, data) {
      log('warn', message, data)
    },
    error(message, data) {
      log('error', message, data)
    },
  }
}
