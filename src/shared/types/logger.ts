/** Shared logger interface used by both main and renderer processes */
export interface Logger {
  debug<TData extends object>(message: string, data?: TData): void
  info<TData extends object>(message: string, data?: TData): void
  warn<TData extends object>(message: string, data?: TData): void
  error<TData extends object>(message: string, data?: TData): void
}
