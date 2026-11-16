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
const invokePrepareImageFromBytes = invoke('attachments:prepare-image-from-bytes')

// A file with no path, such as an image pasted from the clipboard, exists only in memory, so its
// bytes are the attachment (ADR 0068). A blob the browser could not type (a HEIC, for one) is
// taken by its name, and main reads its type from that name.
const PATHLESS_IMAGE_NAME = /\.(?:gif|heic|heif|jpe?g|png|webp)$/iu

async function preparePathlessImage(file: File, fileIndex: number) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return { attachment: await invokePrepareImageFromBytes(bytes, file.name, file.type), fileIndex }
}

async function prepareAttachmentsByPath(
  projectPath: string,
  selected: readonly { readonly path: string; readonly fileIndex: number }[],
) {
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

export async function prepareSelectedAttachments(projectPath: string, files: readonly File[]) {
  const selectedByPath = new Map<string, { readonly path: string; readonly fileIndex: number }>()
  const pathless: { readonly file: File; readonly fileIndex: number }[] = []
  files.forEach((file, fileIndex) => {
    const path = webUtils.getPathForFile(file)
    if (path.length > 0) {
      if (!selectedByPath.has(path)) selectedByPath.set(path, { path, fileIndex })
      return
    }
    // A pathless file that is not an image is skipped, as it always was.
    if (file.type.startsWith('image/') || PATHLESS_IMAGE_NAME.test(file.name)) {
      pathless.push({ file, fileIndex })
    }
  })

  // A preparation that fails rejects, so a pathless image shows the same error a file would.
  const prepared = await Promise.all([
    prepareAttachmentsByPath(projectPath, [...selectedByPath.values()]),
    Promise.all(pathless.map(({ file, fileIndex }) => preparePathlessImage(file, fileIndex))),
  ])
  return prepared.flat().sort((left, right) => left.fileIndex - right.fileIndex)
}
