/**
 * Structured logger for the renderer process.
 * Mirrors the main-process logger API for consistency.
 *
 * In dev: outputs to browser console with namespace prefix.
 * In prod: errors are forwarded to main process via IPC for aggregation.
 */
import type { Logger } from '@shared/types/logger'

function formatMessage(namespace: string, message: string, data?: object): string {
  const prefix = `[${namespace}] ${message}`
  if (!data || Object.keys(data).length === 0) return prefix
  try {
    return `${prefix} ${JSON.stringify(data)}`
  } catch {
    return `${prefix} [unserializable data]`
  }
}

export function createRendererLogger(namespace: string): Logger {
  return {
    debug(message, data) {
      console.debug(formatMessage(namespace, message, data))
    },
    info(message, data) {
      console.info(formatMessage(namespace, message, data))
    },
    warn(message, data) {
      console.warn(formatMessage(namespace, message, data))
    },
    error(message, data) {
      console.error(formatMessage(namespace, message, data))
    },
  }
}
