import { Context, Effect, Layer } from 'effect'
import { createLogger } from '../logger'

export interface AppLoggerService {
  readonly debug: (
    namespace: string,
    message: string,
    data?: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<void>
  readonly info: (
    namespace: string,
    message: string,
    data?: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<void>
  readonly warn: (
    namespace: string,
    message: string,
    data?: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<void>
  readonly error: (
    namespace: string,
    message: string,
    data?: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<void>
}

export class AppLogger extends Context.Tag('@openwaggle/AppLogger')<AppLogger, AppLoggerService>() {
  static readonly Live = Layer.succeed(this, {
    debug: (namespace, message, data) =>
      Effect.sync(() => createLogger(namespace).debug(message, data)),
    info: (namespace, message, data) =>
      Effect.sync(() => createLogger(namespace).info(message, data)),
    warn: (namespace, message, data) =>
      Effect.sync(() => createLogger(namespace).warn(message, data)),
    error: (namespace, message, data) =>
      Effect.sync(() => createLogger(namespace).error(message, data)),
  } satisfies AppLoggerService)
}
