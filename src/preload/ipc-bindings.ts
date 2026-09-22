import type {
  IpcEventChannel,
  IpcEventPayload,
  IpcInvokeArgs,
  IpcInvokeChannel,
  IpcInvokeReturn,
  IpcSendArgs,
  IpcSendChannel,
} from '@shared/types/ipc'
import { ipcRenderer, webUtils } from 'electron'

export function invoke<C extends IpcInvokeChannel>(
  channel: C,
): (...args: IpcInvokeArgs<C>) => Promise<IpcInvokeReturn<C>> {
  return (...args: IpcInvokeArgs<C>) => ipcRenderer.invoke(channel, ...args)
}

export function send<C extends IpcSendChannel>(channel: C): (...args: IpcSendArgs<C>) => void {
  return (...args: IpcSendArgs<C>) => {
    ipcRenderer.send(channel, ...args)
  }
}

export function on<C extends IpcEventChannel>(
  channel: C,
): (callback: (payload: IpcEventPayload<C>) => void) => () => void {
  return (callback: (payload: IpcEventPayload<C>) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: IpcEventPayload<C>) => {
      callback(payload)
    }
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
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
