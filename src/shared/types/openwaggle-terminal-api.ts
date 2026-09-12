import type { IpcEventPayload } from './ipc'
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

/** Session terminal API surface (ADR 0030). */
export interface OpenWaggleTerminalApi {
  getTerminalActivitySnapshot(): Promise<TerminalActivitySnapshot>
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
  assessTerminalClose(
    ownerKey: TerminalOwnerKey,
    terminalId: TerminalId,
  ): Promise<TerminalCloseAssessment>
  writeTerminal(
    ownerKey: TerminalOwnerKey,
    terminalId: TerminalId,
    data: string,
    identity?: TerminalInputIdentity,
    intent?: TerminalInputIntent,
  ): Promise<TerminalWriteResult>
  sendTerminalInputNow(
    ownerKey: TerminalOwnerKey,
    terminalId: TerminalId,
  ): Promise<TerminalInputReleaseResult>
  acknowledgeTerminalOutput(
    ownerKey: TerminalOwnerKey,
    terminalId: TerminalId,
    outputGeneration: number,
    endOffset: number,
  ): void
  migrateTerminalOwner(
    fromOwnerKey: TerminalOwnerKey,
    toOwnerKey: TerminalOwnerKey,
  ): Promise<TerminalOwnerMigrationResult>
  onTerminalEvent(callback: (payload: IpcEventPayload<'terminal:event'>) => void): () => void
  onTerminalActivitySnapshot(
    callback: (payload: IpcEventPayload<'terminal:activity-snapshot'>) => void,
  ): () => void
}
