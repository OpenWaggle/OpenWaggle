export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
  error(message: string, data?: Record<string, unknown>): void
}

function formatLine(namespace: string, message: string, data?: Record<string, unknown>): string {
  if (data && Object.keys(data).length > 0) {
    return `[${namespace}] ${message} ${JSON.stringify(data)}`
  }
  return `[${namespace}] ${message}`
}

export function createLogger(namespace: string): Logger {
  return {
    debug(message, data) {
      console.debug(formatLine(namespace, message, data))
    },
    info(message, data) {
      console.info(formatLine(namespace, message, data))
    },
    warn(message, data) {
      console.warn(formatLine(namespace, message, data))
    },
    error(message, data) {
      console.error(formatLine(namespace, message, data))
    },
  }
}
