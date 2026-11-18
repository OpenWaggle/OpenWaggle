import type { IpcEventMethod, IpcInvokeMethod, IpcSendMethod } from './ipc-api-methods'

/** The Waggle-mode surface of the preload API, split out to keep the main interface within its size budget. */
export interface OpenWaggleWaggleApi {
  // Waggle mode
  sendWaggleMessage: IpcInvokeMethod<'agent:send-waggle-message'>
  cancelWaggle: IpcSendMethod<'agent:cancel-waggle'>
  onWaggleEvent: IpcEventMethod<'waggle:event'>
  onWaggleTurnEvent: IpcEventMethod<'waggle:turn-event'>
  // Waggle presets
  listWagglePresets: IpcInvokeMethod<'waggle-presets:list'>
  saveWagglePreset: IpcInvokeMethod<'waggle-presets:save'>
  deleteWagglePreset: IpcInvokeMethod<'waggle-presets:delete'>
}
