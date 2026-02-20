import type {
  IpcInvokeArgs,
  IpcInvokeChannel,
  IpcInvokeReturn,
  IpcSendArgs,
  IpcSendChannel,
} from '@shared/types/ipc'
import { type IpcMainEvent, type IpcMainInvokeEvent, ipcMain } from 'electron'
import { ZodError } from 'zod'
import { createLogger } from '../logger'

const logger = createLogger('ipc')

/**
 * Map `undefined` return types to also accept `void` (semantically identical for IPC).
 * biome-ignore lint/suspicious/noConfusingVoidType: void is needed here to match handler return types that implicitly return void
 */
type MaybeVoid<T> = T extends undefined ? void | undefined : T

/**
 * Type-safe wrapper around `ipcMain.handle()`.
 * Constrains the channel name, handler args, and return type to `IpcInvokeChannelMap`.
 */
export function typedHandle<C extends IpcInvokeChannel>(
  channel: C,
  handler: (
    event: IpcMainInvokeEvent,
    ...args: IpcInvokeArgs<C>
  ) => MaybeVoid<IpcInvokeReturn<C>> | Promise<MaybeVoid<IpcInvokeReturn<C>>>,
): void {
  ipcMain.handle(channel, handler as Parameters<typeof ipcMain.handle>[1])
}

/**
 * Type-safe wrapper around `ipcMain.on()`.
 * Constrains the channel name and listener args to `IpcSendChannelMap`.
 */
export function typedOn<C extends IpcSendChannel>(
  channel: C,
  listener: (event: IpcMainEvent, ...args: IpcSendArgs<C>) => void,
): void {
  ipcMain.on(channel, listener as Parameters<typeof ipcMain.on>[1])
}

/**
 * Like `typedHandle` but catches `ZodError` throws, logs a structured warning,
 * and re-throws with a human-readable message.
 * Use this for handlers that validate args via Zod `.parse()`.
 */
export function safeHandle<C extends IpcInvokeChannel>(
  channel: C,
  handler: (
    event: IpcMainInvokeEvent,
    ...args: IpcInvokeArgs<C>
  ) => MaybeVoid<IpcInvokeReturn<C>> | Promise<MaybeVoid<IpcInvokeReturn<C>>>,
): void {
  ipcMain.handle(channel, async (event, ...rawArgs) => {
    try {
      return await (handler as (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>)(
        event,
        ...rawArgs,
      )
    } catch (error) {
      if (error instanceof ZodError) {
        const readable = error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
        logger.warn(`Validation failed on "${channel}"`, { issues: readable })
        throw new Error(`Invalid arguments for "${channel}": ${readable}`)
      }
      throw error
    }
  })
}
