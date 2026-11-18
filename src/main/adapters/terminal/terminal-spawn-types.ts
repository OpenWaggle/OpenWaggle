import type { TerminalRuntimeEvent } from '@shared/types/terminal'
import type { TerminalHistoryStore } from './terminal-history-store'
import type { TerminalInputFlow } from './terminal-input-flow'
import type { TerminalOutputFlow } from './terminal-output-flow'
import type { TerminalProcessIdentity } from './terminal-process-identity'
import type { PtyRunner } from './terminal-pty-runner'
import type {
  LiveTerminalProcess,
  RetainedTerminalProcess,
  TerminalRecord,
} from './terminal-records'

export interface TerminalSpawnerDeps {
  readonly runner: PtyRunner
  readonly history: TerminalHistoryStore
  readonly input: TerminalInputFlow
  readonly output: TerminalOutputFlow
  readonly pendingSpawns: WeakMap<TerminalRecord, Set<Promise<void>>>
  readonly registerDetachedProcess: (
    owner: TerminalRecord,
    live: LiveTerminalProcess,
    processPids: readonly number[],
    processIdentities: readonly TerminalProcessIdentity[],
    terminationCommitted: boolean,
    markOwnerInactiveOnRelease: boolean,
  ) => RetainedTerminalProcess
  readonly shutdownRetainedProcess: (target: RetainedTerminalProcess) => Promise<boolean>
  readonly emitEvent: (record: TerminalRecord, event: TerminalRuntimeEvent) => void
  readonly onLivePidsChanged: () => void
  readonly onRecordActive: (record: TerminalRecord) => void
  readonly onRecordInactive: (record: TerminalRecord) => void
}
