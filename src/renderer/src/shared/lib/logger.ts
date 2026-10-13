/**
 * Structured logger for the renderer process.
 * Mirrors the main-process logger API for consistency.
 *
 * In dev: outputs to browser console with namespace prefix.
 * In prod: errors are forwarded to main process via IPC for aggregation.
 */
import type { Logger, LogLevel } from '@shared/types/logger'
import { env } from '@/env'

const LOG_LEVEL_PRIORITIES: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

function isLevelEnabled(level: LogLevel) {
  return LOG_LEVEL_PRIORITIES[level] >= LOG_LEVEL_PRIORITIES[env.logLevel]
}

/**
 * Warn and error data as text. Electron's console log and CDP console readers print an object
 * argument as `[object Object]`, so a failure would reach them without its reason. Errors become
 * `Name: message`; a repeated object becomes `[Circular]`.
 */
function describeLogData(data: object) {
  const seen = new WeakSet<object>()
  return JSON.stringify(data, (_key, value: unknown) => {
    if (value instanceof Error) return `${value.name}: ${value.message}`
    if (typeof value === 'bigint') return value.toString()
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]'
      seen.add(value)
    }
    return value
  })
}

export function createRendererLogger(namespace: string): Logger {
  const log = (level: LogLevel, message: string, data?: object) => {
    if (!isLevelEnabled(level)) {
      return
    }

    const prefix = `[${namespace}] ${message}`
    const consoleMethod = {
      debug: console.debug,
      info: console.info,
      warn: console.warn,
      error: console.error,
    }[level]

    if (data && Object.keys(data).length > 0) {
      // Debug and info logs are frequent; DevTools expands their objects on demand.
      if (level === 'warn' || level === 'error') consoleMethod(`${prefix} ${describeLogData(data)}`)
      else consoleMethod(prefix, data)
      return
    }

    consoleMethod(prefix)
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
