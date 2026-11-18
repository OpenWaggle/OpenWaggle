/**
 * Structured logger for the renderer process.
 * Mirrors the main-process logger API for consistency.
 *
 * In dev: outputs to browser console with namespace prefix.
 * In prod: errors are forwarded to main process via IPC for aggregation.
 */
import type { LogLevel } from '@shared/types/logger'
import { loggerMethods } from '@shared/utils/logger-methods'
import { env } from '@/env'
import { lenientJsonStringify } from './lenient-json'

const LOG_LEVEL_PRIORITIES: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

function isLevelEnabled(level: LogLevel) {
  return LOG_LEVEL_PRIORITIES[level] >= LOG_LEVEL_PRIORITIES[env.logLevel]
}

export function createRendererLogger(namespace: string) {
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
      // Debug and info logs are frequent; DevTools expands their objects on demand. Warn and error
      // data goes into the line: Electron's console log and CDP console readers print an object
      // argument as `[object Object]`, so a failure would reach them without its reason.
      if (level === 'warn' || level === 'error') {
        consoleMethod(`${prefix} ${lenientJsonStringify(data)}`)
      } else {
        consoleMethod(prefix, data)
      }
      return
    }

    consoleMethod(prefix)
  }

  return loggerMethods(log, isLevelEnabled)
}
