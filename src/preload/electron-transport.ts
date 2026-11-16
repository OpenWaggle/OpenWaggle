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

/** The image types an attachment can carry, by the extension a pathless file still has. */
const IMAGE_MIME_TYPES_BY_EXTENSION: Readonly<Record<string, string>> = {
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

/** The image type of a file whose name is all we have, for a file that never had one. */
function imageMimeTypeOf(file: File) {
  if (file.type.startsWith('image/')) return file.type
  const extension = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase()
  return IMAGE_MIME_TYPES_BY_EXTENSION[extension] ?? null
}

/**
 * An image pasted from the clipboard exists only in memory: the browser hands over a blob with no
 * path, so `getPathForFile` answers nothing and the bytes are the attachment (ADR 0068).
 */
async function preparePathlessImage(file: File, fileIndex: number) {
  const mimeType = imageMimeTypeOf(file)
  if (mimeType === null) return null
  const bytes = new Uint8Array(await file.arrayBuffer())
  const attachment = await invokePrepareImageFromBytes(bytes, file.name, mimeType)
  return { attachment, fileIndex }
}

async function prepareAttachmentsByPath(
  projectPath: string,
  selected: readonly { readonly path: string; readonly fileIndex: number }[],
) {
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
  const pathlessImages: { readonly file: File; readonly fileIndex: number }[] = []
  files.forEach((file, fileIndex) => {
    const path = webUtils.getPathForFile(file)
    if (path.length > 0) {
      if (!selectedByPath.has(path)) selectedByPath.set(path, { path, fileIndex })
      return
    }
    pathlessImages.push({ file, fileIndex })
  })
  const selected = [...selectedByPath.values()]

  const [byPath, byBytes] = await Promise.all([
    selected.length === 0 ? Promise.resolve([]) : prepareAttachmentsByPath(projectPath, selected),
    // A file the shell does not read from bytes answers `null` and is skipped; a preparation that
    // fails rejects, so the window shows the same error a file with a path would raise.
    Promise.all(pathlessImages.map(({ file, fileIndex }) => preparePathlessImage(file, fileIndex))),
  ])

  return [...byPath, ...byBytes.filter((prepared) => prepared !== null)].sort(
    (left, right) => left.fileIndex - right.fileIndex,
  )
}
