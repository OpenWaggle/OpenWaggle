import type { Logger, LogLevel } from '@shared/types/logger'

/** The `Logger` both processes hand out, around their own `log` and level check. */
export function loggerMethods(
  log: (level: LogLevel, message: string, data?: object) => void,
  isLevelEnabled: (level: LogLevel) => boolean,
) {
  const logger: Logger = {
    isLevelEnabled,
    isDebugEnabled: () => isLevelEnabled('debug'),
    debug: (message, data) => log('debug', message, data),
    info: (message, data) => log('info', message, data),
    warn: (message, data) => log('warn', message, data),
    error: (message, data) => log('error', message, data),
  }
  return logger
}
