import type {
  TerminalActivitySnapshot,
  TerminalAttachResult,
  TerminalCloseAssessment,
  TerminalId,
  TerminalInputIdentity,
  TerminalInputIntent,
  TerminalInputReleaseResult,
  TerminalOpenInput,
  TerminalOwnerKey,
  TerminalOwnerMigrationResult,
  TerminalWriteResult,
} from './terminal'

/** Session terminal invoke channels (ADR 0030). */
export interface IpcTerminalInvokeChannelMap {
  'terminal:get-activity-snapshot': {
    args: []
    return: TerminalActivitySnapshot
  }
  'terminal:open': {
    args: [input: TerminalOpenInput]
    return: TerminalAttachResult
  }
  'terminal:detach': {
    args: [ownerKey: TerminalOwnerKey, terminalId: TerminalId]
    return: undefined
  }
  'terminal:resize': {
    args: [ownerKey: TerminalOwnerKey, terminalId: TerminalId, cols: number, rows: number]
    return: undefined
  }
  'terminal:clear': {
    args: [ownerKey: TerminalOwnerKey, terminalId: TerminalId]
    return: undefined
  }
  'terminal:restart': {
    args: [input: TerminalOpenInput]
    return: TerminalAttachResult
  }
  'terminal:close': {
    args: [ownerKey: TerminalOwnerKey, terminalId: TerminalId, deleteHistory: boolean]
    return: undefined
  }
  'terminal:assess-close': {
    args: [ownerKey: TerminalOwnerKey, terminalId: TerminalId]
    return: TerminalCloseAssessment
  }
  'terminal:write': {
    args: [
      ownerKey: TerminalOwnerKey,
      terminalId: TerminalId,
      data: string,
      identity?: TerminalInputIdentity,
      intent?: TerminalInputIntent,
    ]
    return: TerminalWriteResult
  }
  'terminal:send-input-now': {
    args: [ownerKey: TerminalOwnerKey, terminalId: TerminalId, incarnation?: string]
    return: TerminalInputReleaseResult
  }
  'terminal:migrate-owner': {
    args: [fromOwnerKey: TerminalOwnerKey, toOwnerKey: TerminalOwnerKey]
    return: TerminalOwnerMigrationResult
  }
}
