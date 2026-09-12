import type {
  TerminalInputIdentity,
  TerminalInputIntent,
  TerminalInputReleaseResult,
  TerminalReadinessSnapshot,
  TerminalWriteResult,
} from '@shared/types/terminal'

export interface TerminalInputDispatchSnapshot {
  readonly waiting: boolean
  readonly error: string | null
  readonly queuedChunks: number
}

export type TerminalInputEnqueueResult =
  | { readonly status: 'accepted' }
  | {
      readonly status: 'rejected'
      readonly reason: 'capacity' | 'inactive'
      readonly error: string
    }

export type TerminalProjectActionEnqueueResult =
  | { readonly status: 'accepted' }
  | {
      readonly status: 'rejected'
      readonly reason: 'capacity' | 'inactive' | 'project-action-pending' | 'transport'
      readonly error: string
    }

export type TerminalInputWriter = (
  ownerKey: string,
  terminalId: string,
  data: string,
  identity: TerminalInputIdentity,
  intent?: TerminalInputIntent,
) => Promise<TerminalWriteResult>

export interface TerminalInputDispatcherOptions {
  readonly maxPendingBytes?: number
  readonly maxPendingOperations?: number
  readonly createGeneration?: () => string
}

export interface TerminalInputClient {
  readonly generation: string
  enqueue(data: string): TerminalInputEnqueueResult
  enqueueAsync(resolveData: () => Promise<string>): Promise<TerminalInputEnqueueResult>
  /** Queue one whole Project Action command and resolve only after main accepts or rejects it. */
  enqueueProjectAction(
    data: string,
    executionId: string,
  ): Promise<TerminalProjectActionEnqueueResult>
  /** Permit acknowledged staging after the matching open invoke has started. */
  markOpening(): void
  markOpen(readiness: TerminalReadinessSnapshot | null, pendingInputBytes?: number): void
  markUnavailable(): void
  markClosed(): void
  markReady(readiness: TerminalReadinessSnapshot): void
  applyReleaseResult(result: TerminalInputReleaseResult): void
  retry(): void
  snapshot(): TerminalInputDispatchSnapshot
  subscribe(listener: (snapshot: TerminalInputDispatchSnapshot) => void): () => void
  release(): void
}

export interface TerminalInputDispatcher {
  acquire(ownerKey: string, terminalId: string): TerminalInputClient
  hasPendingProjectAction(ownerKey: string, terminalId: string): boolean
  assertOwnerMigrationAvailable(
    fromOwnerKey: string,
    toOwnerKey: string,
    terminalIds: readonly string[],
  ): void
  migrateOwner(fromOwnerKey: string, toOwnerKey: string, terminalIds: readonly string[]): void
  clearOwner(ownerKey: string): void
}
