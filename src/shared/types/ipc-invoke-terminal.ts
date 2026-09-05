import type {
  TerminalAttachResult,
  TerminalId,
  TerminalOpenInput,
  TerminalOwnerKey,
} from './terminal'

/** Session terminal invoke channels (ADR 0030). */
export interface IpcTerminalInvokeChannelMap {
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
}
