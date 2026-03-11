import { getParseIssues } from '@shared/schema'
import type {
  IpcInvokeArgs,
  IpcInvokeChannel,
  IpcInvokeReturn,
  IpcSendArgs,
  IpcSendChannel,
} from '@shared/types/ipc'
import * as Cause from 'effect/Cause'
import type { Effect as EffectType } from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Option from 'effect/Option'
import { type IpcMainEvent, type IpcMainInvokeEvent, ipcMain } from 'electron'
import { DatabaseBootstrapError, DatabaseQueryError, type ValidationIssuesError } from '../errors'
import { createLogger } from '../logger'
import type { AppServices } from '../runtime'
import { runAppEffect, runAppEffectExit } from '../runtime'

const logger = createLogger('ipc')

/**
 * Map `undefined` return types to also accept `void` (semantically identical for IPC).
 * biome-ignore lint/suspicious/noConfusingVoidType: void is needed here to match handler return types that implicitly return void
 */
type MaybeVoid<T> = T extends undefined ? void | undefined : T

/**
 * Generic IPC handler type — accepts the event + channel-specific args.
 * Used internally by typedHandle/safeHandle to bridge Electron's untyped
 * ipcMain to our typed channel maps.
 */
type IpcHandler<C extends IpcInvokeChannel> = (
  event: IpcMainInvokeEvent,
  ...args: IpcInvokeArgs<C>
) => MaybeVoid<IpcInvokeReturn<C>> | Promise<MaybeVoid<IpcInvokeReturn<C>>>

type EffectIpcHandler<C extends IpcInvokeChannel> = (
  event: IpcMainInvokeEvent,
  ...args: IpcInvokeArgs<C>
) => EffectType<MaybeVoid<IpcInvokeReturn<C>>, unknown, AppServices>

function isObjectWithUnknownValues(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null
}

function isValidationIssuesError(error: unknown): error is ValidationIssuesError {
  if (!isObjectWithUnknownValues(error) || error._tag !== 'ValidationIssuesError') {
    return false
  }

  return Array.isArray(error.issues) && error.issues.every((issue) => typeof issue === 'string')
}

function isDatabaseBootstrapTaggedError(error: unknown): error is DatabaseBootstrapError {
  return (
    isObjectWithUnknownValues(error) &&
    error._tag === 'DatabaseBootstrapError' &&
    typeof error.stage === 'string' &&
    typeof error.message === 'string'
  )
}

function isDatabaseQueryTaggedError(error: unknown): error is DatabaseQueryError {
  return (
    isObjectWithUnknownValues(error) &&
    error._tag === 'DatabaseQueryError' &&
    typeof error.operation === 'string'
  )
}

function toReadableIssues(issues: readonly string[]): string {
  return issues.join('; ')
}

function toIpcError(channel: IpcInvokeChannel, error: unknown): Error {
  if (isValidationIssuesError(error)) {
    const readable = toReadableIssues(error.issues)
    logger.warn(`Validation failed on "${channel}"`, { issues: readable })
    return new Error(`Invalid arguments for "${channel}": ${readable}`)
  }

  const parseIssues = getParseIssues(error)
  if (parseIssues) {
    const readable = parseIssues.join('; ')
    logger.warn(`Validation failed on "${channel}"`, { issues: readable })
    return new Error(`Invalid arguments for "${channel}": ${readable}`)
  }

  if (error instanceof DatabaseBootstrapError) {
    logger.error(`Database bootstrap failed on "${channel}"`, {
      stage: error.stage,
      message: error.message,
    })
    return new Error('OpenWaggle failed to initialize its application database.')
  }

  if (isDatabaseBootstrapTaggedError(error)) {
    const databaseError = error
    logger.error(`Database bootstrap failed on "${channel}"`, {
      stage: databaseError.stage,
      message: databaseError.message,
    })
    return new Error('OpenWaggle failed to initialize its application database.')
  }

  if (error instanceof DatabaseQueryError) {
    logger.error(`Database query failed on "${channel}"`, {
      operation: error.operation,
    })
    return new Error(`Failed to complete "${channel}" because a database query failed.`)
  }

  if (isDatabaseQueryTaggedError(error)) {
    const databaseError = error
    logger.error(`Database query failed on "${channel}"`, {
      operation: databaseError.operation,
    })
    return new Error(`Failed to complete "${channel}" because a database query failed.`)
  }

  return error instanceof Error ? error : new Error(String(error))
}

/**
 * Type-safe wrapper around `ipcMain.handle()`.
 * Internal — all public handlers should use the Effect-based `typedHandle`.
 */
function rawHandle<C extends IpcInvokeChannel>(channel: C, handler: IpcHandler<C>): void {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: IpcInvokeArgs<C>) =>
    handler(event, ...args),
  )
}

export function typedHandle<C extends IpcInvokeChannel>(
  channel: C,
  handler: EffectIpcHandler<C>,
): void {
  rawHandle(channel, async (event, ...args) => {
    const exit = await runAppEffectExit(handler(event, ...args))

    if (Exit.isSuccess(exit)) {
      return exit.value
    }

    const failure = Cause.failureOption(exit.cause)
    if (Option.isSome(failure)) {
      throw toIpcError(channel, failure.value)
    }

    const defect = Cause.dieOption(exit.cause)
    if (Option.isSome(defect)) {
      throw toIpcError(channel, defect.value)
    }

    throw new Error('An unexpected Effect failure occurred.')
  })
}

/**
 * Type-safe wrapper around `ipcMain.on()`.
 * Internal — all public listeners should use the Effect-based `typedOn`.
 */
function rawOn<C extends IpcSendChannel>(
  channel: C,
  listener: (event: IpcMainEvent, ...args: IpcSendArgs<C>) => void,
): void {
  ipcMain.on(channel, (event: IpcMainEvent, ...args: IpcSendArgs<C>) => listener(event, ...args))
}

type EffectIpcOnHandler<C extends IpcSendChannel> = (
  event: IpcMainEvent,
  ...args: IpcSendArgs<C>
) => EffectType<void, unknown, AppServices>

export function typedOn<C extends IpcSendChannel>(
  channel: C,
  handler: EffectIpcOnHandler<C>,
): void {
  rawOn(channel, (event, ...args) => {
    runAppEffect(handler(event, ...args)).catch((err) => {
      logger.error(`Unhandled error in "${channel}" listener`, {
        error: err instanceof Error ? err.message : String(err),
      })
    })
  })
}
