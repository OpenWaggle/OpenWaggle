import type {
  TerminalActivitySnapshot,
  TerminalAttachResult,
  TerminalCloseAssessment,
  TerminalInputIdentity,
  TerminalInputIntent,
  TerminalInputReleaseResult,
  TerminalOpenInput,
  TerminalOwnerMigrationResult,
  TerminalWriteResult,
} from './terminal'

interface TerminalTarget {
  readonly ownerKey: string
  readonly terminalId: string
}

export interface DesktopTerminalInputs {
  readonly getActivitySnapshot: Record<string, never>
  readonly open: TerminalOpenInput
  readonly restart: TerminalOpenInput
  readonly write: TerminalTarget & {
    readonly data: string
    readonly identity?: TerminalInputIdentity
    readonly intent?: TerminalInputIntent
  }
  readonly sendInputNow: TerminalTarget
  readonly acknowledgeOutput: TerminalTarget & {
    readonly outputGeneration: number
    readonly endOffset: number
  }
  readonly migrateOwner: { readonly fromOwnerKey: string; readonly toOwnerKey: string }
  readonly resize: TerminalTarget & { readonly cols: number; readonly rows: number }
  readonly clear: TerminalTarget
  readonly assessClose: TerminalTarget
  readonly close: TerminalTarget & { readonly deleteHistory: boolean }
  readonly closeAllForOwner: { readonly ownerKey: string; readonly deleteHistory: boolean }
  readonly closeAllUnderPath: { readonly directoryPath: string; readonly deleteHistory: boolean }
  readonly attachSurface: { readonly terminalKey: string; readonly surfaceId: number }
  readonly detachTerminal: TerminalTarget & { readonly surfaceId: number }
  readonly detachSurface: { readonly surfaceId: number }
  readonly closeAll: Record<string, never>
}

export interface DesktopTerminalResults {
  readonly getActivitySnapshot: TerminalActivitySnapshot
  readonly open: TerminalAttachResult
  readonly restart: TerminalAttachResult
  readonly write: TerminalWriteResult
  readonly sendInputNow: TerminalInputReleaseResult
  readonly acknowledgeOutput: null
  readonly migrateOwner: TerminalOwnerMigrationResult
  readonly resize: null
  readonly clear: null
  readonly assessClose: TerminalCloseAssessment
  readonly close: null
  readonly closeAllForOwner: null
  readonly closeAllUnderPath: null
  readonly attachSurface: null
  readonly detachTerminal: null
  readonly detachSurface: null
  readonly closeAll: null
}

export type DesktopTerminalCommand = {
  [K in keyof DesktopTerminalInputs]: {
    readonly service: 'terminal'
    readonly operation: K
    readonly input: DesktopTerminalInputs[K]
  }
}[keyof DesktopTerminalInputs]

export type DesktopTerminalResult = {
  [K in keyof DesktopTerminalResults]: {
    readonly service: 'terminal'
    readonly operation: K
    readonly value: DesktopTerminalResults[K]
  }
}[keyof DesktopTerminalResults]
