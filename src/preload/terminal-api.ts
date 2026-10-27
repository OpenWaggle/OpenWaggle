import { invoke, on, send } from './ipc-bindings'

/** Integrated terminals, kept beside api.ts for its line budget. */
export const terminalApi = {
  getTerminalActivitySnapshot: invoke('terminal:get-activity-snapshot'),
  openTerminal: invoke('terminal:open'),
  detachTerminal: invoke('terminal:detach'),
  resizeTerminal: invoke('terminal:resize'),
  clearTerminal: invoke('terminal:clear'),
  restartTerminal: invoke('terminal:restart'),
  assessTerminalClose: invoke('terminal:assess-close'),
  closeTerminal: invoke('terminal:close'),
  writeTerminal: invoke('terminal:write'),
  sendTerminalInputNow: invoke('terminal:send-input-now'),
  acknowledgeTerminalOutput: send('terminal:ack-output'),
  migrateTerminalOwner: invoke('terminal:migrate-owner'),
  onTerminalEvent: on('terminal:event'),
  onTerminalActivitySnapshot: on('terminal:activity-snapshot'),
}
