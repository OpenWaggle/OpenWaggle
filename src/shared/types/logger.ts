/** Shared logger interface used by both main and renderer processes */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface Logger {
  isLevelEnabled?(level: LogLevel): boolean
  isDebugEnabled?(): boolean
  debug(message: string, data?: object): void
  info(message: string, data?: object): void
  warn(message: string, data?: object): void
  error(message: string, data?: object): void
}
