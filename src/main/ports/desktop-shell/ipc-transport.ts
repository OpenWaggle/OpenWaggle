import type { IpcInvokeChannel, IpcSendChannel } from '@shared/types/ipc'
import { Context } from 'effect'
import type { RendererSurface } from './renderer-surfaces'

/** One request a renderer page made: who sent it. */
export interface IpcInvocation {
  readonly sender: RendererSurface
}

/**
 * The main-process end of the typed channel contract in `@shared/types/ipc` (ADR 0064). The
 * contract and its handlers stay the same on every shell; only this transport changes, from
 * Electron's `ipcMain` to Electrobun's typed RPC.
 *
 * A channel has one `handle` handler; its result (or rejection) answers the page's `invoke`.
 * `on` listeners receive the page's fire-and-forget `send` messages. Arguments arrive as the
 * page sent them, structured-clone decoded and unvalidated; handlers decode them.
 */
export interface IpcMainTransportShape {
  readonly handle: (
    channel: IpcInvokeChannel,
    handler: (invocation: IpcInvocation, ...args: unknown[]) => unknown,
  ) => void
  readonly on: (
    channel: IpcSendChannel,
    listener: (invocation: IpcInvocation, ...args: unknown[]) => void,
  ) => void
}

export class IpcMainTransport extends Context.Tag('@openwaggle/IpcMainTransport')<
  IpcMainTransport,
  IpcMainTransportShape
>() {}
