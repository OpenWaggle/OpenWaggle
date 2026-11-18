import type { IpcInvokeArgs, IpcSendArgs } from '@shared/types/ipc'
import { ipcMain } from 'electron'
import type { IpcMainTransportShape } from '../../ports/desktop-shell/ipc-transport'

/**
 * Electron's `ipcMain`; its events carry the sending `WebContents`, a renderer surface as is.
 * Electron types the arguments `any`; they are what the preload sent for the channel.
 */
export const electronIpcMainTransport: IpcMainTransportShape = {
  handle: (channel, handler) => {
    ipcMain.handle(channel, (event, ...args: IpcInvokeArgs<typeof channel>) =>
      handler(event, ...args),
    )
  },
  on: (channel, listener) => {
    ipcMain.on(channel, (event, ...args: IpcSendArgs<typeof channel>) => listener(event, ...args))
  },
}
