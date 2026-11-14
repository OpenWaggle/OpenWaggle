import type { IpcEventMethod, IpcInvokeMethod, IpcSendMethod } from './ipc-api-methods'

/** Session terminal API surface (ADR 0030). */
export interface OpenWaggleTerminalApi {
  getTerminalActivitySnapshot: IpcInvokeMethod<'terminal:get-activity-snapshot'>
  openTerminal: IpcInvokeMethod<'terminal:open'>
  detachTerminal: IpcInvokeMethod<'terminal:detach'>
  resizeTerminal: IpcInvokeMethod<'terminal:resize'>
  clearTerminal: IpcInvokeMethod<'terminal:clear'>
  restartTerminal: IpcInvokeMethod<'terminal:restart'>
  closeTerminal: IpcInvokeMethod<'terminal:close'>
  assessTerminalClose: IpcInvokeMethod<'terminal:assess-close'>
  writeTerminal: IpcInvokeMethod<'terminal:write'>
  sendTerminalInputNow: IpcInvokeMethod<'terminal:send-input-now'>
  acknowledgeTerminalOutput: IpcSendMethod<'terminal:ack-output'>
  migrateTerminalOwner: IpcInvokeMethod<'terminal:migrate-owner'>
  onTerminalEvent: IpcEventMethod<'terminal:event'>
  onTerminalActivitySnapshot: IpcEventMethod<'terminal:activity-snapshot'>
}
