import fs from 'node:fs'
import path from 'node:path'

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
  error(message: string, data?: Record<string, unknown>): void
}

function formatLine(namespace: string, message: string, data?: Record<string, unknown>): string {
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
  private pruned = false

  init(logsDir: string): void {
    this.logsDir = logsDir
    try {
      fs.mkdirSync(logsDir, { recursive: true })
    } catch {
      // Best-effort directory creation
    }
    this.ensureDatePath()
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
    if (!this.pruned) {
      this.pruned = true
      this.pruneOldLogs()
    }
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

  private pruneOldLogs(): void {
    if (!this.logsDir) return
    const logsDir = this.logsDir
    try {
      const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000
      const entries = fs.readdirSync(logsDir)
      for (const entry of entries) {
        if (!entry.startsWith('openwaggle-') || !entry.endsWith('.log')) continue
        const filePath = path.join(logsDir, entry)
        const stat = fs.statSync(filePath)
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath)
        }
      }
    } catch {
      // Pruning is best-effort
    }
  }
}

const fileWriter = new FileWriter()

/** Call once from index.ts after app.whenReady() to enable file logging. */
export function initFileLogger(logsDir: string): void {
  fileWriter.init(logsDir)
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
