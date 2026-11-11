import { electrobunIpcMainTransport } from '../adapters/electrobun/electrobun-ipc-main-transport'
import type { IpcMainTransportShape } from '../ports/desktop-shell/ipc-transport'

/** The desktop shell's IpcMainTransport (ADR 0064), bound to its Electrobun adapter. */
export const ipcMainTransport: IpcMainTransportShape = electrobunIpcMainTransport
