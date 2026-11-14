import { electronIpcMainTransport } from '../adapters/electron/electron-ipc-main-transport'
import type { IpcMainTransportShape } from '../ports/desktop-shell/ipc-transport'

/** The desktop shell's IpcMainTransport (ADR 0064), bound to its Electron adapter. */
export const ipcMainTransport: IpcMainTransportShape = electronIpcMainTransport
