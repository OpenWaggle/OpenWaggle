/**
 * Renderer API method types derived from the IPC channel maps.
 *
 * `OpenWaggleApi` and its parts bind each method name to a channel through these types, so a
 * method's arguments and resolved value are the channel's, never a second declaration of them.
 */
import type {
  IpcEventChannel,
  IpcEventPayload,
  IpcInvokeArgs,
  IpcInvokeChannel,
  IpcInvokeReturn,
  IpcSendArgs,
  IpcSendChannel,
} from './ipc'

/** An `undefined` channel return resolves as `void`, so a caller or mock may resolve with nothing. */
type ResolvedReturn<T> = [T] extends [undefined] ? void : T

/** A payload-less event (`null`) calls back with no argument. */
type IpcEventCallback<P> = [P] extends [null] ? () => void : (payload: P) => void

/** The method that invokes channel `C`: the channel's args, resolving to its return. */
export type IpcInvokeMethod<C extends IpcInvokeChannel> = (
  ...args: IpcInvokeArgs<C>
) => Promise<ResolvedReturn<IpcInvokeReturn<C>>>

/** The fire-and-forget method that sends on channel `C`. */
export type IpcSendMethod<C extends IpcSendChannel> = (...args: IpcSendArgs<C>) => void

/** The method that subscribes to event channel `C`; it returns the unsubscribe. */
export type IpcEventMethod<C extends IpcEventChannel> = (
  callback: IpcEventCallback<IpcEventPayload<C>>,
) => () => void
