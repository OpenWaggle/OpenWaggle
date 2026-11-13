import {
  type DesktopShellCall,
  type DesktopShellRpc,
  SHELL_EVENT_MESSAGE,
  SHELL_FIRST_FRAME_MESSAGE,
  SHELL_FOCUS_MESSAGE,
  SHELL_HEARTBEAT_REQUEST,
  SHELL_INVOKE_REQUEST,
  SHELL_TOGGLE_DEVTOOLS_MESSAGE,
  SHELL_SEND_MESSAGE,
} from '@shared/types/desktop-shell-rpc'
import type {
  IpcEventChannel,
  IpcEventPayload,
  IpcInvokeArgs,
  IpcInvokeChannel,
  IpcInvokeReturn,
  IpcSendArgs,
  IpcSendChannel,
} from '@shared/types/ipc'
import { ATTACHMENT, BYTES_PER_KIBIBYTE } from '@shared/constants/resource-limits'
import { structuredTransport } from '@shared/structured-wire'
import { Electroview } from 'electrobun/view'

/**
 * The preload's only link to the desktop shell (ADR 0064): the typed channel contract of
 * `@shared/types/ipc` over Electrobun's typed RPC (`DesktopShellRpc`), `window.api`, and the
 * renderer arguments. Every other preload module builds on these.
 * `scripts/build-electrobun-preload.ts` bundles the preload, and the main process injects the
 * bundle into the app's webview
 * (`electrobun-main-window.ts`), which runs it in the page's own world before the page's scripts:
 * WebKit and WebView2 have no context isolation for injected scripts.
 *
 * A rejected invoke carries the main process's message alone, without Electron's
 * "Error invoking remote method" prefix; `ipcFailureMessage` reads both.
 */

/** Set by the main process at the top of the injected preload, before this bundle runs. */
const RENDERER_ARGUMENTS_GLOBAL = '__openwaggleRendererArguments'
const BYTES_PER_MEBIBYTE = BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE

const rpc = Electroview.defineRPC<DesktopShellRpc>({
  // An invoke may wait on the user (a dialog, an approval) for as long as it takes.
  maxRequestTime: Infinity,
  handlers: { requests: { [SHELL_HEARTBEAT_REQUEST]: () => true } },
})
const electroview = new Electroview({ rpc })
rpc.setTransport(structuredTransport(electroview.createTransport()))

const eventListeners = new Map<string, Set<(payload: unknown) => void>>()
rpc.addMessageListener(SHELL_FOCUS_MESSAGE, () => globalThis.focus())
rpc.addMessageListener(SHELL_EVENT_MESSAGE, (event: DesktopShellCall) => {
  for (const listener of eventListeners.get(event.channel) ?? []) listener(event.args[0])
})

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : []
}

const injectedArguments = stringArray(Reflect.get(globalThis, RENDERER_ARGUMENTS_GLOBAL))
Reflect.deleteProperty(globalThis, RENDERER_ARGUMENTS_GLOBAL)

/** What the main process passed this page, as Electron's `additionalArguments` do. */
export function rendererArguments() {
  return injectedArguments
}

/** Exposes `value` to the page as `window[key]`, read-only. */
export function exposeInMainWorld(key: string, value: unknown) {
  Object.defineProperty(globalThis, key, { value, enumerable: true })
}

/**
 * The contract boundary. What crosses the RPC is unvalidated JSON; the page trusts its own main
 * process to answer each channel with the type `@shared/types/ipc` names, exactly as Electron's
 * `ipcRenderer` types its answers `any`. These two overloads are the only place that trust is
 * stated: the implementation signatures take and give `unknown`, the public ones the contract.
 */
function invokeChannel<C extends IpcInvokeChannel>(
  channel: C,
  args: IpcInvokeArgs<C>,
): Promise<IpcInvokeReturn<C>>
function invokeChannel(channel: IpcInvokeChannel, args: readonly unknown[]): Promise<unknown> {
  return rpc.request(SHELL_INVOKE_REQUEST, { channel, args }, { maxRequestTime: Infinity })
}

function listenChannel<C extends IpcEventChannel>(
  channel: C,
  callback: (payload: IpcEventPayload<C>) => void,
): () => void
function listenChannel(channel: IpcEventChannel, callback: (payload: unknown) => void) {
  const listener = (payload: unknown) => callback(payload)
  const listeners = eventListeners.get(channel) ?? new Set()
  listeners.add(listener)
  eventListeners.set(channel, listeners)
  return () => {
    listeners.delete(listener)
  }
}

export function invoke<C extends IpcInvokeChannel>(channel: C) {
  return (...args: IpcInvokeArgs<C>) => invokeChannel(channel, args)
}

export function send<C extends IpcSendChannel>(channel: C) {
  return (...args: IpcSendArgs<C>) => {
    void rpc.send(SHELL_SEND_MESSAGE, { channel, args })
  }
}

export function on<C extends IpcEventChannel>(channel: C) {
  return (callback: (payload: IpcEventPayload<C>) => void) => listenChannel(channel, callback)
}

/** Tells the main process the page can be shown (`first-frame.ts`). */
export function sendFirstFrame() {
  void rpc.send(SHELL_FIRST_FRAME_MESSAGE)
}

// F12 asks the main process to toggle this page's DevTools; only unpackaged builds act on it.
globalThis.addEventListener('keydown', (event) => {
  if (event.code === 'F12') void rpc.send(SHELL_TOGGLE_DEVTOOLS_MESSAGE)
})

const invokePrepareFiles = invoke('attachments:prepare-files')

/**
 * The system webviews give a picked or dropped `File` no path, so the page hands main each file's
 * content (`attachments:prepare-files`), which main stages and prepares as Electron prepared
 * paths. A file over the attachment size limit is refused here, before it is read.
 */
export async function prepareSelectedAttachments(projectPath: string, files: readonly File[]) {
  if (files.length === 0) return []
  const oversized = files.find((file) => file.size > ATTACHMENT.MAX_SIZE_BYTES)
  if (oversized) {
    throw new Error(
      `${oversized.name} is larger than ${String(ATTACHMENT.MAX_SIZE_BYTES / BYTES_PER_MEBIBYTE)} MB.`,
    )
  }
  const contents = await Promise.all(
    files.map(async (file) => ({
      name: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    })),
  )
  const attachments = await invokePrepareFiles(projectPath, contents)
  if (attachments.length !== files.length) {
    throw new Error('Attachment preparation returned an unexpected result count.')
  }
  return attachments.map((attachment, fileIndex) => ({ attachment, fileIndex }))
}
