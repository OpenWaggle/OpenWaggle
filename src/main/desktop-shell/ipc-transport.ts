import { electronIpcMainTransport } from '../adapters/electron/electron-ipc-main-transport'
import type { IpcMainTransportShape } from '../ports/desktop-shell/ipc-transport'

/** The desktop shell's IpcMainTransport (ADR 0064); the shell switch changes only this binding. */
export const ipcMainTransport: IpcMainTransportShape = electronIpcMainTransport
