/** Shared logger interface used by both main and renderer processes */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface Logger {
  isLevelEnabled?(level: LogLevel): boolean
  isDebugEnabled?(): boolean
  debug<TData extends object>(message: string, data?: TData): void
  info<TData extends object>(message: string, data?: TData): void
  warn<TData extends object>(message: string, data?: TData): void
  error<TData extends object>(message: string, data?: TData): void
}
