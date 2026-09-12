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

export function prepareSelectedAttachments(projectPath: string, files: readonly File[]) {
  const paths: string[] = []
  for (const file of files) {
    const filePath = webUtils.getPathForFile(file)
    if (filePath.length > 0) paths.push(filePath)
  }

  if (paths.length === 0) {
    return Promise.resolve([])
  }

  return invokePrepareAttachments(projectPath, paths)
}
