import type { IpcInvocation, IpcMainTransportShape } from '../../ports/desktop-shell/ipc-transport'
import type { RendererSurface } from '../../ports/desktop-shell/renderer-surfaces'

/**
 * Electrobun's end of the IPC channel contract (ADR 0064). Each app webview's typed RPC
 * (`electrobun-renderer-surfaces.ts`) hands its page's `shell:invoke` requests and `shell:send`
 * messages here, with the page's surface as the sender. Arguments arrive decoded but unvalidated,
 * as the port promises; the channel's handler decodes them.
 */
type ContractHandler = (invocation: IpcInvocation, ...args: never) => unknown

const invokeHandlers = new Map<string, ContractHandler>()
const sendListeners = new Map<string, ContractHandler[]>()

/** The rejection a page sees: always an `Error`, whose message is all the RPC carries. */
function asError(cause: unknown) {
  return cause instanceof Error ? cause : new Error(String(cause))
}

/** Answers one page invoke with its channel handler, as Electron's `ipcMain.handle` does. */
export async function answerInvoke(
  sender: RendererSurface,
  channel: string,
  args: readonly unknown[],
) {
  const handler = invokeHandlers.get(channel)
  if (!handler) throw new Error(`No handler registered for '${channel}'`)
  try {
    // The handler's arguments are the page's, typed by the contract it sent with.
    const result: unknown = await Reflect.apply(handler, undefined, [{ sender }, ...args])
    return result
  } catch (cause) {
    throw asError(cause)
  }
}

/** Delivers one page send to every listener of its channel. */
export function deliverSend(sender: RendererSurface, channel: string, args: readonly unknown[]) {
  for (const listener of sendListeners.get(channel) ?? []) {
    Reflect.apply(listener, undefined, [{ sender }, ...args])
  }
}

export const electrobunIpcMainTransport: IpcMainTransportShape = {
  handle: (channel, handler) => {
    invokeHandlers.set(channel, handler)
  },
  on: (channel, listener) => {
    sendListeners.set(channel, [...(sendListeners.get(channel) ?? []), listener])
  },
}
