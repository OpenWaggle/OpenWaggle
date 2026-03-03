import fs from 'node:fs'
import { mkdir, readdir, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import type { Logger } from '@shared/types/logger'

export type { Logger }

function formatLine(namespace: string, message: string, data?: object): string {
  const ts = new Date().toISOString().slice(11, 23) // HH:mm:ss.mmm
  if (data && Object.keys(data).length > 0) {
    return `${ts} [${namespace}] ${message} ${JSON.stringify(data)}`
  }
  return `${ts} [${namespace}] ${message}`
}

// --- File writer (injected logsDir, async buffered writes) ---

const LOG_RETENTION_DAYS = 3

class FileWriter {
  private logsDir: string | null = null
  private currentDate: string | null = null
  private currentPath: string | null = null
  private buffer: string[] = []
  private flushScheduled = false

  init(logsDir: string): Promise<void> {
    this.logsDir = logsDir
    this.ensureDatePath()
    // Directory creation + old log pruning runs async — best-effort, non-blocking
    return mkdir(logsDir, { recursive: true })
      .then(() => this.pruneOldLogs())
      .catch(() => {})
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
    const dateStr = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
    if (dateStr === this.currentDate) return
    this.currentDate = dateStr
    this.currentPath = path.join(this.logsDir ?? '', `openwaggle-${dateStr}.log`)
  }

  private flush(): void {
    this.flushScheduled = false
    if (!this.currentPath || this.buffer.length === 0) return
    const batch = `${this.buffer.join('\n')}\n`
    this.buffer.length = 0
    fs.appendFile(this.currentPath, batch, () => {
      // Fire-and-forget — errors are swallowed to prevent logging from crashing the app
    })
  }

  private async pruneOldLogs(): Promise<void> {
    if (!this.logsDir) return
    const logsDir = this.logsDir
    try {
      const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000
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
    } catch {
      // Pruning is best-effort
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
