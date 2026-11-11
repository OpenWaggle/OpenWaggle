import type {
  IpcEventChannel,
  IpcEventPayload,
  IpcInvokeArgs,
  IpcInvokeChannel,
  IpcInvokeReturn,
  IpcSendArgs,
  IpcSendChannel,
} from '@shared/types/ipc'
import { vi } from 'vitest'

/**
 * A stand-in for `../transport` (the Electrobun RPC link), so preload tests drive `window.api`
 * through the same channel calls without a webview. Each test mocks the module with
 * `fakePreloadTransport()` and asserts on `shellChannel`, which records every call by channel.
 */
type Listener = (payload: unknown) => void

export const shellChannel = {
  invoke: vi.fn<(channel: string, ...args: readonly unknown[]) => Promise<unknown>>(),
  send: vi.fn<(channel: string, ...args: readonly unknown[]) => void>(),
  on: vi.fn<(channel: string, listener: Listener) => void>(),
  removeListener: vi.fn<(channel: string, listener: Listener) => void>(),
}

export const exposedInMainWorld = new Map<string, unknown>()

/**
 * The contract boundary of the stand-in, as in the real transport: the recorded channel answers
 * `unknown`, and these overloads state that a test's answer is the channel's contract type.
 */
function invokeChannel<C extends IpcInvokeChannel>(
  channel: C,
  args: IpcInvokeArgs<C>,
): Promise<IpcInvokeReturn<C>>
function invokeChannel(channel: IpcInvokeChannel, args: readonly unknown[]): Promise<unknown> {
  return shellChannel.invoke(channel, ...args)
}

function listenChannel<C extends IpcEventChannel>(
  channel: C,
  callback: (payload: IpcEventPayload<C>) => void,
): () => void
function listenChannel(channel: IpcEventChannel, callback: Listener) {
  const listener: Listener = (payload) => callback(payload)
  shellChannel.on(channel, listener)
  return () => shellChannel.removeListener(channel, listener)
}

/** `rendererArguments`: what main passed the page, read when a preload module asks. */
export function fakePreloadTransport(rendererArguments: () => readonly string[] = () => []) {
  return {
    rendererArguments,
    exposeInMainWorld: (key: string, value: unknown) => {
      exposedInMainWorld.set(key, value)
    },
    invoke:
      <C extends IpcInvokeChannel>(channel: C) =>
      (...args: IpcInvokeArgs<C>) =>
        invokeChannel(channel, args),
    send:
      <C extends IpcSendChannel>(channel: C) =>
      (...args: IpcSendArgs<C>) => {
        shellChannel.send(channel, ...args)
      },
    on:
      <C extends IpcEventChannel>(channel: C) =>
      (callback: (payload: IpcEventPayload<C>) => void) =>
        listenChannel(channel, callback),
    prepareSelectedAttachments: vi.fn(async () => []),
  }
}
