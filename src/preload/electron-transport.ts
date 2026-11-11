import type {
  IpcEventChannel,
  IpcEventPayload,
  IpcInvokeArgs,
  IpcInvokeChannel,
  IpcInvokeReturn,
  IpcSendArgs,
  IpcSendChannel,
} from '@shared/types/ipc'
import { contextBridge, type IpcRendererEvent, ipcRenderer, webUtils } from 'electron'

/**
 * The preload's only link to the desktop shell (ADR 0064): the typed channel contract of
 * `@shared/types/ipc` over Electron's `ipcRenderer`, the `contextBridge` that exposes `window.api`,
 * and file paths of dropped files. Every other preload module builds on these, so another shell's
 * preload would replace this module (and the crash-report SDK bridge in
 * `error-reporting-bridge.ts`).
 */

/** What the main process passed this page (`webPreferences.additionalArguments`). */
export function rendererArguments(): readonly string[] {
  return process.argv
}

/** Exposes `value` to the renderer page as `window[key]`, across context isolation. */
export function exposeInMainWorld(key: string, value: unknown) {
  contextBridge.exposeInMainWorld(key, value)
}

export function invoke<C extends IpcInvokeChannel>(channel: C) {
  const result: (...args: IpcInvokeArgs<C>) => Promise<IpcInvokeReturn<C>> = (
    ...args: IpcInvokeArgs<C>
  ) => ipcRenderer.invoke(channel, ...args)
  return result
}

export function send<C extends IpcSendChannel>(channel: C) {
  const result: (...args: IpcSendArgs<C>) => void = (...args: IpcSendArgs<C>) => {
    ipcRenderer.send(channel, ...args)
  }
  return result
}

export function on<C extends IpcEventChannel>(channel: C) {
  const result: (callback: (payload: IpcEventPayload<C>) => void) => () => void = (
    callback: (payload: IpcEventPayload<C>) => void,
  ) => {
    const handler = (_event: IpcRendererEvent, payload: IpcEventPayload<C>) => {
      callback(payload)
    }
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
  return result
}

const invokePrepareAttachments = invoke('attachments:prepare')

export async function prepareSelectedAttachments(projectPath: string, files: readonly File[]) {
  const selectedByPath = new Map<string, { readonly path: string; readonly fileIndex: number }>()
  files.forEach((file, fileIndex) => {
    const path = webUtils.getPathForFile(file)
    if (path.length > 0 && !selectedByPath.has(path)) selectedByPath.set(path, { path, fileIndex })
  })
  const selected = [...selectedByPath.values()]
  if (selected.length === 0) return []

  const attachments = await invokePrepareAttachments(
    projectPath,
    selected.map(({ path }) => path),
  )
  if (attachments.length !== selected.length) {
    throw new Error('Attachment preparation returned an unexpected result count.')
  }
  return attachments.map((attachment, index) => ({
    attachment,
    fileIndex: selected[index]?.fileIndex ?? index,
  }))
}
