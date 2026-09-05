import type { IpcEventPayload } from './ipc'
import type {
  TerminalAttachResult,
  TerminalId,
  TerminalOpenInput,
  TerminalOwnerKey,
} from './terminal'

/** Session terminal API surface (ADR 0030). */
export interface OpenWaggleTerminalApi {
  openTerminal(input: TerminalOpenInput): Promise<TerminalAttachResult>
  detachTerminal(ownerKey: TerminalOwnerKey, terminalId: TerminalId): Promise<void>
  resizeTerminal(
    ownerKey: TerminalOwnerKey,
    terminalId: TerminalId,
    cols: number,
    rows: number,
  ): Promise<void>
  clearTerminal(ownerKey: TerminalOwnerKey, terminalId: TerminalId): Promise<void>
  restartTerminal(input: TerminalOpenInput): Promise<TerminalAttachResult>
  closeTerminal(
    ownerKey: TerminalOwnerKey,
    terminalId: TerminalId,
    deleteHistory: boolean,
  ): Promise<void>
  writeTerminal(ownerKey: TerminalOwnerKey, terminalId: TerminalId, data: string): void
  onTerminalEvent(callback: (payload: IpcEventPayload<'terminal:event'>) => void): () => void
}
