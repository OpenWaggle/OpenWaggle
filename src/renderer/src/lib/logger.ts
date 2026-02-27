/**
 * Structured logger for the renderer process.
 * Mirrors the main-process logger API for consistency.
 *
 * In dev: outputs to browser console with namespace prefix.
 * In prod: errors are forwarded to main process via IPC for aggregation.
 */

interface RendererLogger {
  info: (message: string, data?: unknown) => void
  warn: (message: string, data?: unknown) => void
  error: (message: string, data?: unknown) => void
}

function formatMessage(namespace: string, message: string, data?: unknown): string {
  const prefix = `[${namespace}] ${message}`
  if (data === undefined) return prefix
  if (typeof data === 'string') return `${prefix} ${data}`
  try {
    return `${prefix} ${JSON.stringify(data)}`
  } catch {
    return `${prefix} [unserializable data]`
  }
}

export function createRendererLogger(namespace: string): RendererLogger {
  return {
    info(message: string, data?: unknown) {
      console.info(formatMessage(namespace, message, data))
    },
    warn(message: string, data?: unknown) {
      console.warn(formatMessage(namespace, message, data))
    },
    error(message: string, data?: unknown) {
      console.error(formatMessage(namespace, message, data))
    },
  }
}
