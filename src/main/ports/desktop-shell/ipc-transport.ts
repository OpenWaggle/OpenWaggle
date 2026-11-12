import type {
  IpcInvokeArgs,
  IpcInvokeChannel,
  IpcSendArgs,
  IpcSendChannel,
} from '@shared/types/ipc'
import { Context } from 'effect'
import type { RendererSurface } from './renderer-surfaces'

/** One request a renderer page made: who sent it. */
export interface IpcInvocation {
  readonly sender: RendererSurface
}

/**
 * The main-process end of the typed channel contract in `@shared/types/ipc` (ADR 0064). The
 * contract and its handlers do not depend on the shell; the Electron adapter carries them over
 * `ipcMain`.
 *
 * A channel has one `handle` handler; its result (or rejection) answers the page's `invoke`.
 * `on` listeners receive the page's fire-and-forget `send` messages. Arguments arrive as the
 * page sent them, structured-clone decoded: typed by the contract the preload sends with, but
 * unvalidated, so handlers still decode them.
 */
export interface IpcMainTransportShape {
  readonly handle: <C extends IpcInvokeChannel>(
    channel: C,
    handler: (invocation: IpcInvocation, ...args: IpcInvokeArgs<C>) => unknown,
  ) => void
  readonly on: <C extends IpcSendChannel>(
    channel: C,
    listener: (invocation: IpcInvocation, ...args: IpcSendArgs<C>) => void,
  ) => void
}

export class IpcMainTransport extends Context.Tag('@openwaggle/IpcMainTransport')<
  IpcMainTransport,
  IpcMainTransportShape
>() {}
